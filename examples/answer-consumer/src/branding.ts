/** The application's own look. The card exposes CSS custom properties; the application sets them. */
export interface Branding {
  readonly name: string;
  readonly fontFamily: string;
  readonly accent: string;
  readonly surface: string;
  readonly text: string;
}

export const brandings = {
  nur: { name: 'Nur Library', fontFamily: 'Georgia, "Times New Roman", serif', accent: '#7a3e00', surface: '#fff8ec', text: '#2b2118' },
  harbor: { name: 'Harbor Notes', fontFamily: '"Helvetica Neue", Arial, sans-serif', accent: '#005a9c', surface: '#eef5fb', text: '#10202e' },
} as const satisfies Record<string, Branding>;

export type BrandName = keyof typeof brandings;
