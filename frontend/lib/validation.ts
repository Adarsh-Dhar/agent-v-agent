/**
 * Production-grade validation utilities for the Agent Arena app
 * All validators throw or return false on invalid input
 */

export class ValidationError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

// String validation
export function validateNonEmptyString(value: unknown, fieldName: string, maxLength = 255): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(
      400,
      'INVALID_STRING',
      `Bad Request: ${fieldName} must be a non-empty string`
    )
  }

  if (value.length > maxLength) {
    throw new ValidationError(
      400,
      'STRING_TOO_LONG',
      `Bad Request: ${fieldName} must be less than ${maxLength} characters`
    )
  }

  return value.trim()
}

// Integer validation
export function validateInteger(value: unknown, fieldName: string, min?: number, max?: number): number {
  if (!Number.isInteger(value)) {
    throw new ValidationError(
      400,
      'INVALID_INTEGER',
      `Bad Request: ${fieldName} must be an integer`
    )
  }

  const num = value as number

  if (min !== undefined && num < min) {
    throw new ValidationError(
      400,
      'INTEGER_TOO_SMALL',
      `Bad Request: ${fieldName} must be at least ${min}`
    )
  }

  if (max !== undefined && num > max) {
    throw new ValidationError(
      400,
      'INTEGER_TOO_LARGE',
      `Bad Request: ${fieldName} must be at most ${max}`
    )
  }

  return num
}

// UUID validation
export function validateUUID(value: unknown, fieldName: string): string {
  const str = validateNonEmptyString(value, fieldName, 36)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  
  if (!uuidRegex.test(str)) {
    throw new ValidationError(
      400,
      'INVALID_UUID',
      `Bad Request: ${fieldName} must be a valid UUID`
    )
  }

  return str
}

// Enum validation
export function validateEnum<T>(value: unknown, fieldName: string, allowedValues: T[]): T {
  if (!allowedValues.includes(value as T)) {
    throw new ValidationError(
      400,
      'INVALID_ENUM',
      `Bad Request: ${fieldName} must be one of: ${allowedValues.join(', ')}`
    )
  }

  return value as T
}

// User ID validation
export function validateUserId(value: unknown, fieldName = 'user_id'): string {
  const userId = validateNonEmptyString(value, fieldName, 100)
  if (userId.length < 1) {
    throw new ValidationError(
      400,
      'INVALID_USER_ID',
      `Bad Request: ${fieldName} must be a valid user identifier`
    )
  }
  return userId
}

// Match code validation
export function validateMatchCode(value: unknown, fieldName = 'match_code'): string {
  const code = validateNonEmptyString(value, fieldName, 10)
  if (!/^[A-Z0-9]{6,10}$/.test(code)) {
    throw new ValidationError(
      400,
      'INVALID_MATCH_CODE',
      `Bad Request: ${fieldName} must be 6-10 alphanumeric characters`
    )
  }
  return code.toUpperCase()
}

// Email validation
export function validateEmail(value: unknown, fieldName = 'email'): string {
  const email = validateNonEmptyString(value, fieldName, 255)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  
  if (!emailRegex.test(email)) {
    throw new ValidationError(
      400,
      'INVALID_EMAIL',
      `Bad Request: ${fieldName} must be a valid email address`
    )
  }

  return email.toLowerCase()
}

// Array validation
export function validateArray<T>(value: unknown, fieldName: string, minLength = 0, maxLength = 1000): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(
      400,
      'INVALID_ARRAY',
      `Bad Request: ${fieldName} must be an array`
    )
  }

  if (value.length < minLength) {
    throw new ValidationError(
      400,
      'ARRAY_TOO_SHORT',
      `Bad Request: ${fieldName} must have at least ${minLength} items`
    )
  }

  if (value.length > maxLength) {
    throw new ValidationError(
      400,
      'ARRAY_TOO_LONG',
      `Bad Request: ${fieldName} must have at most ${maxLength} items`
    )
  }

  return value
}
