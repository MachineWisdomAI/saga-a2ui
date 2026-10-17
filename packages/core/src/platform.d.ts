// The only platform global core relies on. Browsers and Node provide it; the ES2022 library
// types do not declare it, and core deliberately does not load the DOM or Node typings.
declare function structuredClone<T>(value: T): T;
