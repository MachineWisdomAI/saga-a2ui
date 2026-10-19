// An asset imported with `?inline` is the bytes of the file as a `data:` URL in the built document.
declare module '*?inline' {
  const url: string;
  export default url;
}
