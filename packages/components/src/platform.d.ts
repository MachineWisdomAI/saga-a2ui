// The platform globals this package relies on: the WHATWG `URL`. Browsers, Node and the Lynx
// runtimes provide them; the ES2022 library types do not declare them, and this package deliberately
// loads neither the DOM nor the Node typings. Programs that do load those typings (this package's
// own test configuration) get the real declarations and do not include this file.
declare class URL {
  constructor(input: string, base?: string);
  readonly href: string;
  readonly origin: string;
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
}

// The surface layout in `@saga-a2ui/core` copies values with the platform's `structuredClone`,
// which every runtime this package targets provides.
declare function structuredClone<T>(value: T): T;
