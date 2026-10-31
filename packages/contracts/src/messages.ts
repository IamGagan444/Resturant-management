import { z } from "zod";

/**
 * Plain-language validation messages, shared by the API and every form. Field-specific wording
 * (PIN, phone, GSTIN…) stays on the schema; this covers the generic cases.
 */
const friendly: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") return { message: "Required" };
      if (issue.expected === "number") return { message: "Enter a number" };
      break;
    case z.ZodIssueCode.too_small:
      if (issue.type === "string") return { message: issue.minimum === 1 ? "Required" : `At least ${issue.minimum} characters` };
      if (issue.type === "number") return { message: `Must be at least ${issue.minimum}` };
      if (issue.type === "array") return { message: issue.minimum === 1 ? "Pick at least one" : `Pick at least ${issue.minimum}` };
      break;
    case z.ZodIssueCode.too_big:
      if (issue.type === "string") return { message: `At most ${issue.maximum} characters` };
      if (issue.type === "number") return { message: `Must be at most ${issue.maximum}` };
      break;
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { message: "Enter a valid email" };
      if (issue.validation === "url") return { message: "Enter a full address starting with https://" };
      break;
    case z.ZodIssueCode.invalid_enum_value:
      return { message: "Choose one of the options" };
  }
  return { message: ctx.defaultError };
};

z.setErrorMap(friendly);
