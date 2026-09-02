import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 合并 Tailwind className，避免冲突 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
