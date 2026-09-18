import { useEffect, useRef, useState } from 'react';
import {
  advance,
  guide,
  initialMachine,
  promptFor,
  userMsg,
  type ChatMachineState,
  type IntakeAnswers,
} from '../intake/chatMachine';

export function IntakeChat({
  initialAnswers,
  onComplete,
  onAnswersChange,
  busy,
}: {
  initialAnswers: IntakeAnswers;
  onComplete: (answers: IntakeAnswers) => void;
  onAnswersChange?: (answers: IntakeAnswers) => void;
  busy?: boolean;
}) {
  const [machine, setMachine] = useState<ChatMachineState>(() => initialMachine(initialAnswers));
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [machine.messages.length, machine.stepId]);

  useEffect(() => {
    onAnswersChange?.(machine.answers);
  }, [machine.answers, onAnswersChange]);

  function send(raw: string) {
    if (busy) return;
    const text = raw.trim();
    if (!text) return;
    setHint(null);
    const result = advance(machine.stepId, machine.answers, text);
    if (!result.ok) {
      setHint(result.error);
      return;
    }

    if (machine.stepId === 'submit' && result.echo === 'Submit') {
      setMachine((m) => ({
        ...m,
        answers: result.answers,
        messages: [...m.messages, userMsg(result.echo)],
      }));
      onComplete(result.answers);
      return;
    }

    const nextPrompt = promptFor(result.next, result.answers);
    setMachine({
      stepId: result.next,
      answers: result.answers,
      confirming: result.next.startsWith('confirm_'),
      messages: [...machine.messages, userMsg(result.echo), guide(nextPrompt)],
    });
    setDraft('');
  }

  const chips =
    machine.stepId === 'welcome'
      ? ['Ready']
      : machine.stepId.startsWith('confirm_') || machine.stepId === 'confirm_pets'
        ? ['Yes', 'No']
        : machine.stepId === 'ask_occupant' || machine.stepId === 'ask_pet'
          ? ['None']
          : machine.stepId === 'ask_more_occupants' || machine.stepId === 'ask_more_pets'
            ? ['Done']
            : machine.stepId === 'ask_vehicle'
              ? ['Skip']
              : machine.stepId === 'review'
                ? ['Continue', 'Edit']
                : machine.stepId === 'submit'
                  ? ['Submit']
                  : [];

  return (
    <section className="dwel-guide" aria-label="Dwel guide application chat">
      <header className="dwel-guide-head">
        <div className="dwel-guide-avatar" aria-hidden>
          <span />
        </div>
        <div>
          <p className="dwel-guide-name">Dwel guide</p>
        </div>
      </header>

      <div className="dwel-guide-thread" role="log" aria-live="polite">
        {machine.messages.map((m) => (
          <div key={m.id} className={`dwel-bubble ${m.role}`}>
            {m.role === 'guide' && (
              <div className="dwel-guide-avatar sm" aria-hidden>
                <span />
              </div>
            )}
            <div className="dwel-bubble-text">{m.text}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {chips.length > 0 && (
        <div className="dwel-guide-chips">
          {chips.map((c) => (
            <button key={c} type="button" className="pill" disabled={busy} onClick={() => send(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

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
    </section>
  );
}
