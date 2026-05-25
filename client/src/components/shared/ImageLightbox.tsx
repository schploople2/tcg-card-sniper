import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

/**
 * n5f — In-app image lightbox.
 *
 * Renders the supplied image full-bleed inside a Radix Dialog portal,
 * centered, with a dark backdrop and a corner X button. Closing
 * conventions are the Radix defaults: click backdrop, press Escape,
 * or click the X.
 *
 * Controlled — `src` null means closed. Stays unmounted when closed so
 * we don't pay layout cost between opens.
 *
 * Built on Radix primitives directly (rather than the styled
 * components/ui/dialog wrapper) so the content container is transparent
 * and the image isn't boxed in by padding/border/max-w-lg defaults.
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  const open = src != null;
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          // z-[60] so we sit above LotAnalyzerModal's own z-50 portal.
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          // Title is sr-only to satisfy Radix accessibility — visible
          // surface is just the image.
          aria-describedby={undefined}
          className="fixed inset-0 z-[60] flex items-center justify-center p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none"
          data-testid="image-lightbox"
        >
          <DialogPrimitive.Title className="sr-only">
            Photo preview
          </DialogPrimitive.Title>
          {src && (
            <img
              src={src}
              alt={alt ?? ""}
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-sm shadow-2xl"
              data-testid="image-lightbox-img"
            />
          )}
          <DialogPrimitive.Close
            aria-label="Close image preview"
            className="absolute top-4 right-4 rounded-full bg-slate-900/80 p-2 text-slate-200 hover:bg-slate-800 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-slate-400"
            data-testid="image-lightbox-close"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
