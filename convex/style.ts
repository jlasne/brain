/**
 * How every text a model writes for a reader reads: the house style, written once and put into each prompt that needs it.
 * The full rule goes where a model writes positions and answers; the short ones where it writes a line or a field.
 */

/** The full rule: answers, positions, summaries. */
export const STYLE = "No em-dashes. Under 30 words per sentence. Replace adjectives with data. No weasel words. Simple wording.";

/** For a reply or a note: the two rules that matter at that length. */
export const SHORT_STYLE = "No em-dashes. Under 30 words per sentence.";

/** For a title, a line or a field. */
export const NO_DASH = "No em-dashes.";
