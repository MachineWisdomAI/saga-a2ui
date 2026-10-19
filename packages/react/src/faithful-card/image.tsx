import { useLayoutEffect, useRef, type ReactElement } from 'react';

/**
 * An image the content policy has permitted, with the consent it needs. The element is created
 * without an address and receives it in a layout effect, which React runs only for a committed
 * tree. React creates the elements of a render it may still discard, and a browser requests an
 * image as soon as an element has an address, so an address given while rendering could start a
 * request for consent that ended before the render was shown. Setting it on commit means a request
 * exists only for an image that is on screen. Strict Mode's replay finds the address already set
 * and changes nothing, so a replay does not request the image twice.
 */
export function CommittedImage(props: {
  readonly url: string;
  readonly alt: string;
  /** Strict loads the image the reader just asked for at once; Standard lets the browser wait until it is near. */
  readonly eager: boolean;
  readonly onFailure: () => void;
}): ReactElement {
  const { url, alt, eager, onFailure } = props;
  const element = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const image = element.current;
    if (image !== null && image.getAttribute('src') !== url) image.setAttribute('src', url);
  }, [url]);
  return (
    <img
      ref={element}
      data-testid="md-image"
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={onFailure}
    />
  );
}
