import { z, type ZodErrorMap } from 'zod';

/** Hebrew error messages for every Zod validation failure shown to users. */
export const hebrewErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'שדה חובה' };
      return { message: 'ערך לא תקין' };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string')
        return { message: issue.minimum === 1 ? 'שדה חובה' : `נדרשים לפחות ${issue.minimum} תווים` };
      if (issue.type === 'number') return { message: `הערך המינימלי הוא ${issue.minimum}` };
      if (issue.type === 'array') return { message: `יש לבחור לפחות ${issue.minimum}` };
      return { message: 'ערך קטן מדי' };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `עד ${issue.maximum} תווים` };
      if (issue.type === 'number') return { message: `הערך המקסימלי הוא ${issue.maximum}` };
      return { message: 'ערך גדול מדי' };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'כתובת אימייל לא תקינה' };
      return { message: 'פורמט לא תקין' };
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
      return { message: 'ערך לא מוכר' };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: 'שדות לא מוכרים בבקשה' };
    default:
      return { message: ctx.defaultError === 'Invalid input' ? 'קלט לא תקין' : ctx.defaultError };
  }
};

z.setErrorMap(hebrewErrorMap);
