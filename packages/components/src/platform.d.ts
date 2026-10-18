// The one platform global this package relies on: the WHATWG `URL`. Browsers, Node and the Lynx
// runtimes provide it; the ES2022 library types do not declare it, and this package deliberately
// loads neither the DOM nor the Node typings. Programs that do load those typings (this package's
// own test configuration) get the real declaration and do not include this file.
declare class URL {
  constructor(input: string, base?: string);
  readonly href: string;
  readonly origin: string;
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
}
