import type { en } from "./locales/en.ts";

type Shape<Entries> = { readonly [Key in keyof Entries]: Entries[Key] extends string ? string : Shape<Entries[Key]> };

// Every language holds exactly the keys English does, so one that falls behind fails the typecheck, not a reader.
export type Catalog = Shape<typeof en>;
