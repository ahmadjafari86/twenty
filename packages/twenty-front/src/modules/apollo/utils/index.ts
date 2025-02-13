import { ApolloLink, gql, Operation } from '@apollo/client';

import { isNonNullable } from '~/utils/isNonNullable';
import { logDebug } from '~/utils/logDebug';
import { logError } from '~/utils/logError';

import formatTitle from './format-title';

const getGroup = (collapsed: boolean) =>
  collapsed
    ? console.groupCollapsed.bind(console)
    : console.group.bind(console);

const parseQuery = (queryString: string) => {
  const queryObj = gql`
    ${queryString}
  `;

  const { name } = queryObj.definitions[0] as any;
  return [name ? name.value : 'Generic', queryString.trim()];
};

export const loggerLink = (getSchemaName: (operation: Operation) => string) =>
  new ApolloLink((operation, forward) => {
    const schemaName = getSchemaName(operation);
    operation.setContext({ start: Date.now() });

    const { variables } = operation;

    const operationType = (operation.query.definitions[0] as any).operation;
    const headers = operation.getContext().headers;

    const [queryName, query] = parseQuery(operation.query.loc!.source.body);

    if (operationType === 'subscription') {
      const date = new Date().toLocaleTimeString();

      const titleArgs = formatTitle(operationType, schemaName, queryName, date);

      console.groupCollapsed(...titleArgs);

      if (variables && Object.keys(variables).length !== 0) {
        logDebug('VARIABLES', variables);
      }

      logDebug('QUERY', query);

      console.groupEnd();

      return forward(operation);
    }

    return forward(operation).map((result) => {
      const time = Date.now() - operation.getContext().start;
      const errors = result.errors ?? result.data?.[queryName]?.errors;
      const hasError = Boolean(errors);

      try {
        const titleArgs = formatTitle(
          operationType,
          schemaName,
          queryName,
          time,
        );

        getGroup(!hasError)(...titleArgs);

        if (isNonNullable(errors)) {
          errors.forEach((err: any) => {
            logDebug(
              `%c${err.message}`,
              // eslint-disable-next-line @nx/workspace-no-hardcoded-colors
              'color: #F51818; font-weight: lighter',
            );
          });
        }

        logDebug('HEADERS: ', headers);

        if (variables && Object.keys(variables).length !== 0) {
          logDebug('VARIABLES', variables);
        }

        logDebug('QUERY', query);

        if (isNonNullable(result.data)) {
          logDebug('RESULT', result.data);
        }
        if (isNonNullable(errors)) {
          logDebug('ERRORS', errors);
        }

        console.groupEnd();
      } catch {
        // this may happen if console group is not supported
        logDebug(
          `${operationType} ${schemaName}::${queryName} (in ${time} ms)`,
        );
        if (isNonNullable(errors)) {
          logError(errors);
        }
      }

      return result;
    });
  });
