/**
 * AI extension point (SPEC § 7.9). Only the `none` implementation ships: Panel makes no LLM calls.
 * A future implementation (local model) must treat its output as untrusted data: sanitized,
 * length-limited, and never able to trigger an alert on its own.
 */
export interface Summarizer {
  summarize(input: {
    title: string;
    text: string;
    lang: string;
  }): Promise<{ en: string; fr: string } | null>;
}

export const SUMMARY_STATUSES = ['none', 'pending', 'done', 'failed'] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

export class NoneSummarizer implements Summarizer {
  summarize(): Promise<null> {
    return Promise.resolve(null);
  }
}
