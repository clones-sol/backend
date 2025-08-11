declare module 'buffer-layout' {
  export interface Layout<T = any> {
    span: number;
    property?: string;
    encode: (value: T, buffer: Buffer, offset: number) => number;
    decode: (buffer: Buffer, offset: number) => T;
  }

  export function struct<T = any>(fields: Layout[], property?: string): Layout<T>;
  export function u8(property?: string): Layout<number>;
  export function u64(property?: string): Layout<number>;
  export function publicKey(property?: string): Layout<string>;
  export function str(property?: string): Layout<string>;
  export function bool(property?: string): Layout<boolean>;
}
