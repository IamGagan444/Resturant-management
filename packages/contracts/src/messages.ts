import { z } from "zod";

/**
 * Plain-language validation messages, shared by the API and every form. Field-specific wording
 * (PIN, phone, GSTIN…) stays on the schema; this covers the generic cases.
 * Returning undefined falls back to Zod's own message.
 */
const friendly: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined || issue.input === null) return "Required";
      if (issue.expected === "number" || issue.expected === "int") return "Enter a number";
      return undefined;
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string") return min === 1 ? "Required" : `At least ${min} characters`;
      if (issue.origin === "number" || issue.origin === "int") return `Must be at least ${min}`;
      if (issue.origin === "array") return min === 1 ? "Pick at least one" : `Pick at least ${min}`;
      return undefined;
    }
    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string") return `At most ${max} characters`;
      if (issue.origin === "number" || issue.origin === "int") return `Must be at most ${max}`;
      if (issue.origin === "array") return `At most ${max}`;
      return undefined;
    }
    case "invalid_format":
      if (issue.format === "email") return "Enter a valid email";
      if (issue.format === "url") return "Enter a full address starting with https://";
      return undefined;
    case "invalid_value":
      return "Choose one of the options";
    default:
      return undefined;
  }
};

z.config({ customError: friendly });
