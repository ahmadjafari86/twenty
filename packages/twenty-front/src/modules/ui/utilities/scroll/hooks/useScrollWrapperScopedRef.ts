import { useContext } from 'react';

import { isNullable } from '~/utils/isNullable';

import { ScrollWrapperContext } from '../components/ScrollWrapper';

export const useScrollWrapperScopedRef = () => {
  const scrollWrapperRef = useContext(ScrollWrapperContext);

  if (isNullable(scrollWrapperRef))
    throw new Error(
      `Using a scroll ref without a ScrollWrapper : verify that you are using a ScrollWrapper if you intended to do so.`,
    );

  return scrollWrapperRef;
};
