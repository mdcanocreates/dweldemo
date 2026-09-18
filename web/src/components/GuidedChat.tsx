import { useEffect, useRef, useState } from 'react';
import type { RenterAnswers } from '../intake/answers';
import {
  advanceApp,
  firstAppStep,
  guide as appGuide,
  promptFor as appPrompt,
  reviewText as appReview,
  userMsg as appUser,
  type AppStepId,
  type ChatMessage,
} from '../intake/applicationMachine';
import {
  advanceProfile,
  firstProfileStep,
  guide as profileGuide,
  promptFor as profilePrompt,
  reviewText as profileReview,
  userMsg as profileUser,
  type ProfileStepId,
} from '../intake/profileMachine';

export function GuidedChat({
  mode,
  initialAnswers,
  onComplete,
  onAnswersChange,
  busy,
}: {
  mode: 'profile' | 'application';
  initialAnswers: RenterAnswers;
  onComplete: (answers: RenterAnswers) => void;
  onAnswersChange?: (answers: RenterAnswers) => void;
  busy?: boolean;
}) {
  const [answers, setAnswers] = useState(initialAnswers);
  const [step, setStep] = useState<string>(() =>
    mode === 'profile' ? firstProfileStep(initialAnswers) : firstAppStep(initialAnswers),
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const s = mode === 'profile' ? firstProfileStep(initialAnswers) : firstAppStep(initialAnswers);
    const text =
      mode === 'profile'
        ? s === 'review'
          ? profileReview(initialAnswers)
          : profilePrompt(s as ProfileStepId)
        : s === 'review'
          ? appReview(initialAnswers)
          : appPrompt(s as AppStepId, initialAnswers);
    return [mode === 'profile' ? profileGuide(text) : appGuide(text)];
  });
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, step]);

  useEffect(() => {
    onAnswersChange?.(answers);
  }, [answers, onAnswersChange]);

  function send(raw: string) {
    if (busy) return;
    const text = raw.trim();
    if (!text) return;
    setHint(null);

    if (mode === 'profile') {
      const result = advanceProfile(step as ProfileStepId, answers, text);
      if (!result.ok) {
        setHint(result.error);
        return;
      }
      const u = profileUser(result.echo);
      if (result.done) {
        setMessages((m) => [...m, u]);
        setAnswers(result.answers);
        onComplete(result.answers);
        return;
      }
      const nextText =
        result.next === 'review' ? profileReview(result.answers) : profilePrompt(result.next);
      setAnswers(result.answers);
      setStep(result.next);
      setMessages((m) => [...m, u, profileGuide(nextText)]);
      setDraft('');
      return;
    }

    const result = advanceApp(step as AppStepId, answers, text);
    if (!result.ok) {
      setHint(result.error);
      return;
    }
    const u = appUser(result.echo);
    if (result.done) {
      setMessages((m) => [...m, u]);
      setAnswers(result.answers);
      onComplete(result.answers);
      return;
    }
    const nextText =
      result.next === 'review' ? appReview(result.answers) : appPrompt(result.next, result.answers);
    setAnswers(result.answers);
    setStep(result.next);
    setMessages((m) => [...m, u, appGuide(nextText)]);
    setDraft('');
  }

  const chips =
    step === 'welcome'
      ? ['Ready']
      : step === 'ask_pets'
        ? ['Yes', 'No']
        : step === 'ask_move_in' && mode === 'profile'
          ? ['ASAP', 'within 30', 'within 60', 'flexible']
          : step === 'review'
            ? ['Continue', 'Edit']
            : step === 'submit'
              ? ['Submit']
              : [];

  return (
    <section className="dwel-guide" aria-label="Dwel guide chat" id="dwel-chat">
      <header className="dwel-guide-head">
        <div className="dwel-guide-avatar" aria-hidden>
          <span />
        </div>
        <div>
          <p className="dwel-guide-name">Dwel guide</p>
        </div>
      </header>

      {/* Scrolls internally — chips live here, not in the pinned input bar */}
      <div className="chat-messages dwel-guide-thread" role="log" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`dwel-bubble ${m.role}`}>
            {m.role === 'guide' && (
              <div className="dwel-guide-avatar sm" aria-hidden>
                <span />
              </div>
            )}
            <div className="dwel-bubble-text">{m.text}</div>
          </div>
        ))}
        {chips.length > 0 && (
          <div className="dwel-guide-chips">
            {chips.map((c) => (
              <button key={c} type="button" className="pill" disabled={busy} onClick={() => send(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pinned — outside the scrolling message area */}
      <div className="chat-input dwel-guide-footer">
        {hint && <p className="dwel-guide-hint">{hint}</p>}
        <form
          className="dwel-guide-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type your answer…"
            disabled={busy}
            aria-label="Chat reply"
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
