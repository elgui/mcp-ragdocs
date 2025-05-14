/**
 * This is a sample TypeScript file to test JSDoc extraction.
 * It contains various classes and functions with JSDoc comments.
 */

/**
 * Interface representing a person
 */
interface Person {
  /** The person's name */
  name: string;
  /** The person's age */
  age: number;
  /** Optional email address */
  email?: string;
}

/**
 * A class representing a user in the system
 * 
 * @example
 * const user = new User('John Doe', 30);
 * user.greet(); // "Hello, my name is John Doe"
 */
class User implements Person {
  /**
   * Create a new User
   * 
   * @param name - The user's name
   * @param age - The user's age
   * @param email - Optional email address
   */
  constructor(
    public name: string,
    public age: number,
    public email?: string
  ) {}

  /**
   * Generate a greeting from the user
   * 
   * @returns A greeting string
   */
  greet(): string {
    return `Hello, my name is ${this.name}`;
  }

  /**
   * Update the user's profile information
   * 
   * @param updates - Object containing the fields to update
   * @returns The updated user object
   */
  updateProfile(updates: Partial<Person>): User {
    if (updates.name) this.name = updates.name;
    if (updates.age) this.age = updates.age;
    if (updates.email) this.email = updates.email;
    return this;
  }
}

/**
 * Calculate the sum of an array of numbers
 * 
 * @param numbers - Array of numbers to sum
 * @returns The sum of all numbers
 * @throws Error if the input is not an array of numbers
 */
function sum(numbers: number[]): number {
  if (!Array.isArray(numbers)) {
    throw new Error('Input must be an array');
  }
  
  return numbers.reduce((total, num) => {
    if (typeof num !== 'number') {
      throw new Error('All elements must be numbers');
    }
    return total + num;
  }, 0);
}

/**
 * Format a date as a string
 * 
 * @param date - The date to format
 * @param format - The format to use (default: 'YYYY-MM-DD')
 * @returns The formatted date string
 */
function formatDate(date: Date, format: string = 'YYYY-MM-DD'): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  let result = format;
  result = result.replace('YYYY', String(year));
  result = result.replace('MM', month);
  result = result.replace('DD', day);
  
  return result;
}

/**
 * Process data with an optional transformation function
 * 
 * This function demonstrates a more complex JSDoc with multiple
 * paragraphs and examples.
 * 
 * @param data - The data to process
 * @param transform - Optional transformation function
 * @returns The processed data
 * 
 * @example
 * // Basic usage
 * processData({ name: 'test' });
 * // => { name: 'test', processed: true }
 * 
 * @example
 * // With transformation
 * processData({ name: 'test' }, data => {
 *   data.transformed = true;
 *   return data;
 * });
 * // => { name: 'test', processed: true, transformed: true }
 */
function processData<T extends object>(
  data: T,
  transform?: (data: T) => T
): T & { processed: boolean } {
  let result = { ...data, processed: true };
  
  if (transform) {
    result = { ...transform(result as T), processed: true };
  }
  
  return result as T & { processed: boolean };
}

// Example usage
if (require.main === module) {
  // Create a user
  const user = new User('John Doe', 30, 'john@example.com');
  console.log(user.greet());
  
  // Update the user's profile
  user.updateProfile({ age: 31 });
  console.log(`Updated age: ${user.age}`);
  
  // Calculate a sum
  const numbers = [1, 2, 3, 4, 5];
  const total = sum(numbers);
  console.log(`Sum: ${total}`);
  
  // Format a date
  const today = new Date();
  console.log(`Today: ${formatDate(today)}`);
  console.log(`Custom format: ${formatDate(today, 'DD/MM/YYYY')}`);
  
  // Process data
  const data = { name: 'Example', value: 42 };
  const result = processData(data, d => {
    return { ...d, extraField: 'added' };
  });
  console.log(`Processed data:`, result);
}
