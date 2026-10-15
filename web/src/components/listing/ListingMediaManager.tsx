import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '../ui/Button';

export type MediaItem = {
  id: string;
  previewUrl: string;
  file?: File;
  name: string;
  progress?: number;
  status?: 'pending' | 'uploading' | 'ready' | 'error';
  error?: string;
};

type Props = {
  photos: MediaItem[];
  onChange: (photos: MediaItem[]) => void;
  maxPhotos?: number;
  disabled?: boolean;
};

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

function isAcceptedFile(file: File): string | null {
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    return 'SVG files are not allowed for listing photos.';
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'Only JPEG, PNG, and WebP images are accepted.';
  }
  if (file.size > MAX_BYTES) {
    return 'Each photo must be 10 MB or smaller.';
  }
  return null;
}

function createMediaItem(file: File): MediaItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    name: file.name,
    previewUrl: URL.createObjectURL(file),
    status: 'ready',
    progress: 100,
  };
}

export function ListingMediaManager({
  photos,
  onChange,
  maxPhotos = 15,
  disabled = false,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const createdUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const p of photos) {
      if (p.previewUrl.startsWith('blob:')) {
        createdUrlsRef.current.add(p.previewUrl);
      }
    }
  }, [photos]);

  useEffect(
    () => () => {
      for (const url of createdUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    },
    [],
  );

  const revokeIfOwned = useCallback((url: string) => {
    if (createdUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      createdUrlsRef.current.delete(url);
    }
  }, []);

  function addFiles(fileList: FileList | File[] | null) {
    if (!fileList?.length || disabled) return;
    setValidationError(null);
    const next = [...photos];
    let lastError: string | null = null;

    for (const file of Array.from(fileList)) {
      if (next.length >= maxPhotos) {
        lastError = `Maximum ${maxPhotos} photos allowed.`;
        break;
      }
      const err = isAcceptedFile(file);
      if (err) {
        lastError = err;
        continue;
      }
      next.push(createMediaItem(file));
    }

    if (lastError) setValidationError(lastError);
    if (next.length !== photos.length) onChange(next);
  }

  function removePhoto(id: string) {
    if (disabled) return;
    const removed = photos.find((p) => p.id === id);
    if (removed) revokeIfOwned(removed.previewUrl);
    onChange(photos.filter((p) => p.id !== id));
  }

  function setCover(id: string) {
    if (disabled) return;
    const index = photos.findIndex((p) => p.id === id);
    if (index <= 0) return;
    const next = [...photos];
    const [item] = next.splice(index, 1);
    next.unshift(item!);
    onChange(next);
  }

  function movePhoto(id: string, direction: -1 | 1) {
    if (disabled) return;
    const index = photos.findIndex((p) => p.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= photos.length) return;
    const next = [...photos];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    onChange(next);
  }

  function reorder(from: number, to: number) {
    if (disabled || from === to || from < 0 || to < 0 || from >= photos.length || to >= photos.length) {
      return;
    }
    const next = [...photos];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      addFiles(e.dataTransfer.files);
      return;
    }
    const fromRaw = e.dataTransfer.getData('text/plain');
    const from = Number(fromRaw);
    if (!Number.isNaN(from)) {
      const el = (e.target as HTMLElement).closest('[data-photo-index]');
      const toRaw = el?.getAttribute('data-photo-index');
      if (toRaw != null) reorder(from, Number(toRaw));
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={onDrop}
        className={`rounded-[16px] border-2 border-dashed px-4 py-10 text-center transition-colors sm:px-8 ${
          disabled
            ? 'cursor-not-allowed border-dwel-line bg-dwel-surface2 opacity-60'
            : dragOver
              ? 'border-dwel-blue bg-[#eaf0ff]'
              : 'border-dwel-line bg-dwel-surface2 hover:border-dwel-blue/50'
        }`}
      >
        <p className="text-lg font-semibold text-dwel-gray-900">Add photos of your home</p>
        <p className="mt-2 text-sm text-dwel-muted">Drag photos here, or browse files</p>
        <p className="mt-1 text-xs text-dwel-muted">
          Up to {maxPhotos} photos · JPG, PNG or WebP · 10 MB each
        </p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          multiple
          className="sr-only"
          disabled={disabled || photos.length >= maxPhotos}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          className="mt-5"
          variant="secondary"
          disabled={disabled || photos.length >= maxPhotos}
          onClick={() => inputRef.current?.click()}
        >
          Browse photos
        </Button>
      </div>

      <div className="rounded-[12px] border border-dwel-line bg-white px-4 py-3 text-sm text-dwel-muted">
        <p className="font-medium text-dwel-gray-900">Recommendations</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Add at least 3 photos before publishing — renters engage more with complete galleries.</li>
          <li>Lead with a bright exterior or living-room shot as your cover photo.</li>
          <li>Use natural light; avoid blurry or heavily filtered images.</li>
        </ul>
      </div>

      {validationError ? <p className="text-sm text-dwel-red">{validationError}</p> : null}

      {photos.length > 0 ? (
        <div>
          <p className="mb-3 text-sm font-medium text-dwel-gray-900">
            {photos.length} of {maxPhotos} photos · first image is the cover
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((photo, index) => (
              <div
                key={photo.id}
                data-photo-index={index}
                draggable={!disabled}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', String(index));
                  e.dataTransfer.effectAllowed = 'move';
                  setDragIndex(index);
                }}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const from = Number(e.dataTransfer.getData('text/plain'));
                  if (!Number.isNaN(from)) reorder(from, index);
                  setDragIndex(null);
                }}
                className={`group relative overflow-hidden rounded-[12px] border bg-white ${
                  dragIndex === index ? 'border-dwel-blue opacity-70' : 'border-dwel-line'
                } ${index === 0 ? 'ring-2 ring-dwel-blue ring-offset-1' : ''}`}
              >
                <div className="relative aspect-square w-full bg-dwel-surface2">
                  <img
                    src={photo.previewUrl}
                    alt={photo.name || `Listing photo ${index + 1}`}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                  {index === 0 ? (
                    <span className="absolute left-2 top-2 rounded-md bg-dwel-blue px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      Cover
                    </span>
                  ) : null}
                  {photo.status === 'uploading' && photo.progress != null ? (
                    <div className="absolute inset-x-0 bottom-0 bg-black/50 px-2 py-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/30">
                        <div
                          className="h-full rounded-full bg-dwel-mint transition-all"
                          style={{ width: `${photo.progress}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-[10px] text-white">{photo.progress}%</p>
                    </div>
                  ) : null}
                  {photo.status === 'error' ? (
                    <p className="absolute inset-x-0 bottom-0 bg-dwel-red/90 px-2 py-1 text-[10px] text-white">
                      {photo.error ?? 'Upload failed'}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1 border-t border-dwel-line p-2">
                  <p className="truncate text-xs text-dwel-muted" title={photo.name}>
                    {photo.name}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {index !== 0 ? (
                      <button
                        type="button"
                        disabled={disabled}
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-dwel-blue hover:bg-[#eaf0ff] disabled:opacity-50"
                        onClick={() => setCover(photo.id)}
                      >
                        Set as cover
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={disabled || index === 0}
                      aria-label={`Move ${photo.name} up`}
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-dwel-muted hover:bg-dwel-surface2 disabled:opacity-40"
                      onClick={() => movePhoto(photo.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={disabled || index === photos.length - 1}
                      aria-label={`Move ${photo.name} down`}
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-dwel-muted hover:bg-dwel-surface2 disabled:opacity-40"
                      onClick={() => movePhoto(photo.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold text-dwel-red hover:bg-red-50 disabled:opacity-50"
                      onClick={() => removePhoto(photo.id)}
                    >
                      Remove
                    </button>
                  </div>
                  {!disabled ? (
                    <p className="text-[10px] text-dwel-muted">Drag to reorder</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-dwel-muted">No photos added yet.</p>
      )}
    </div>
  );
}
