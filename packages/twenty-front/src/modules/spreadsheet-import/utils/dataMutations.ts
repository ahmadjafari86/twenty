import { isNonEmptyString } from '@sniptt/guards';
import { v4 } from 'uuid';

import {
  Errors,
  Meta,
} from '@/spreadsheet-import/steps/components/ValidationStep/types';
import {
  Data,
  Fields,
  Info,
  RowHook,
  TableHook,
} from '@/spreadsheet-import/types';
import { isNonNullable } from '~/utils/isNonNullable';
import { isNullable } from '~/utils/isNullable';

export const addErrorsAndRunHooks = <T extends string>(
  data: (Data<T> & Partial<Meta>)[],
  fields: Fields<T>,
  rowHook?: RowHook<T>,
  tableHook?: TableHook<T>,
): (Data<T> & Meta)[] => {
  const errors: Errors = {};

  const addHookError = (rowIndex: number, fieldKey: T, error: Info) => {
    errors[rowIndex] = {
      ...errors[rowIndex],
      [fieldKey]: error,
    };
  };

  if (isNonNullable(tableHook)) {
    data = tableHook(data, addHookError);
  }

  if (isNonNullable(rowHook)) {
    data = data.map((value, index) =>
      rowHook(value, (...props) => addHookError(index, ...props), data),
    );
  }

  fields.forEach((field) => {
    field.validations?.forEach((validation) => {
      switch (validation.rule) {
        case 'unique': {
          const values = data.map((entry) => entry[field.key as T]);

          const taken = new Set(); // Set of items used at least once
          const duplicates = new Set(); // Set of items used multiple times

          values.forEach((value) => {
            if (
              validation.allowEmpty === true &&
              (isNullable(value) || value === '' || !value)
            ) {
              // If allowEmpty is set, we will not validate falsy fields such as undefined or empty string.
              return;
            }

            if (taken.has(value)) {
              duplicates.add(value);
            } else {
              taken.add(value);
            }
          });

          values.forEach((value, index) => {
            if (duplicates.has(value)) {
              errors[index] = {
                ...errors[index],
                [field.key]: {
                  level: validation.level || 'error',
                  message: validation.errorMessage || 'Field must be unique',
                },
              };
            }
          });
          break;
        }
        case 'required': {
          data.forEach((entry, index) => {
            if (
              entry[field.key as T] === null ||
              entry[field.key as T] === undefined ||
              entry[field.key as T] === ''
            ) {
              errors[index] = {
                ...errors[index],
                [field.key]: {
                  level: validation.level || 'error',
                  message: validation.errorMessage || 'Field is required',
                },
              };
            }
          });
          break;
        }
        case 'regex': {
          const regex = new RegExp(validation.value, validation.flags);
          data.forEach((entry, index) => {
            const value = entry[field.key]?.toString();

            if (isNonEmptyString(value) && !value.match(regex)) {
              errors[index] = {
                ...errors[index],
                [field.key]: {
                  level: validation.level || 'error',
                  message:
                    validation.errorMessage ||
                    `Field did not match the regex /${validation.value}/${validation.flags} `,
                },
              };
            }
          });
          break;
        }
        case 'function': {
          data.forEach((entry, index) => {
            const value = entry[field.key]?.toString();

            if (isNonEmptyString(value) && !validation.isValid(value)) {
              errors[index] = {
                ...errors[index],
                [field.key]: {
                  level: validation.level || 'error',
                  message: validation.errorMessage || 'Field is invalid',
                },
              };
            }
          });
          break;
        }
      }
    });
  });

  return data.map((value, index) => {
    // This is required only for table. Mutates to prevent needless rerenders
    if (!('__index' in value)) {
      value.__index = v4();
    }
    const newValue = value as Data<T> & Meta;

    if (isNonNullable(errors[index])) {
      return { ...newValue, __errors: errors[index] };
    }
    if (isNullable(errors[index]) && isNonNullable(value?.__errors)) {
      return { ...newValue, __errors: null };
    }
    return newValue;
  });
};
