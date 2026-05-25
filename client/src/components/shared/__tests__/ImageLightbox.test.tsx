import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageLightbox } from "../ImageLightbox";

describe("ImageLightbox", () => {
  it("renders nothing when src is null", () => {
    render(<ImageLightbox src={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
    expect(screen.queryByTestId("image-lightbox-img")).not.toBeInTheDocument();
  });

  it("renders the image with the supplied src + alt when open", () => {
    render(
      <ImageLightbox
        src="https://i.example/listing.jpg"
        alt="My alt"
        onClose={vi.fn()}
      />
    );
    const img = screen.getByTestId("image-lightbox-img") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe("https://i.example/listing.jpg");
    expect(img.alt).toBe("My alt");
  });

  it("calls onClose when the X button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ImageLightbox src="https://i.example/x.jpg" onClose={onClose} />
    );
    fireEvent.click(screen.getByTestId("image-lightbox-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <ImageLightbox src="https://i.example/x.jpg" onClose={onClose} />
    );
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the click hits the empty backdrop area (not the image)", () => {
    const onClose = vi.fn();
    render(
      <ImageLightbox src="https://i.example/x.jpg" onClose={onClose} />
    );
    // Click on the Content wrapper itself (target === currentTarget)
    fireEvent.click(screen.getByTestId("image-lightbox"));
    expect(onClose).toHaveBeenCalled();
  });

  it("does NOT close when the click is on the image itself", () => {
    const onClose = vi.fn();
    render(
      <ImageLightbox src="https://i.example/x.jpg" onClose={onClose} />
    );
    fireEvent.click(screen.getByTestId("image-lightbox-img"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("defaults alt to '' when not supplied (decorative image)", () => {
    render(<ImageLightbox src="https://i.example/x.jpg" onClose={vi.fn()} />);
    const img = screen.getByTestId("image-lightbox-img") as HTMLImageElement;
    expect(img.alt).toBe("");
  });
});
