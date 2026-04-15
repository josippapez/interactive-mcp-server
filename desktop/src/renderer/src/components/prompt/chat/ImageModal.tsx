import React, { memo, useCallback } from 'react';

interface ImageModalProps {
  image: { src: string; name: string };
  onClose: () => void;
}

/**
 * Image modal for displaying expanded image attachments.
 */
const ImageModal = memo(function ImageModal({
  image,
  onClose,
}: ImageModalProps): React.ReactElement {
  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={handleBackdropClick}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={handleContentClick}
      >
        <div className="flex items-center justify-between w-full mb-2 px-1">
          <span className="text-xs text-white/70 truncate max-w-[80%]">
            {image.name}
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
          src={image.src}
          alt={image.name}
          className="max-w-full max-h-[85vh] rounded-sm object-contain"
        />
      </div>
    </div>
  );
});

export default ImageModal;
