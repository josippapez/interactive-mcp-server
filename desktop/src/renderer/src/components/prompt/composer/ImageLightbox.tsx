type ImageLightboxProps = {
  src: string;
  name: string;
  onClose: () => void;
};

/** Expanded image modal (lightbox) for attachment preview */
export function ImageLightbox({
  src,
  name,
  onClose,
}: ImageLightboxProps): React.ReactElement {
  return (
    <div
      role="dialog"
      aria-label="Image preview"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between w-full mb-2 px-1">
          <span className="text-xs text-white/70 truncate max-w-[80%]">
            {name}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-white/70 hover:text-white text-sm px-2 py-0.5"
            aria-label="Close image preview"
          >
            ESC
          </button>
        </div>
        <img
          src={src}
          alt={name}
          className="max-w-full max-h-[85vh] rounded-sm object-contain"
        />
      </div>
    </div>
  );
}
