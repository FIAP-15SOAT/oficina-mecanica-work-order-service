/**
 * Rejects, at compile time, a key the catalog entry does not declare.
 * TypeScript's native excess-property check only reaches fresh literals at the
 * call site; this form also catches an object built earlier, in a variable.
 */
export type NoExtraFields<TAllowed, TGiven> = TGiven &
  Record<Exclude<keyof TGiven, keyof TAllowed>, never>;
