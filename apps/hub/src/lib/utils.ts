import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names, with later Tailwind utilities winning over earlier
 * ones in the same group. Required by the shadcn components.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
