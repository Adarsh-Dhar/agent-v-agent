# Production-Grade Error Handling in Agent Arena

This document outlines the comprehensive error handling and validation system implemented throughout the Agent Arena application.

## Overview

All APIs and frontend code follow production standards with:
- **Input Validation** - Type and range checking on all inputs
- **Error Classification** - Proper HTTP status codes (400, 401, 403, 404, 409, 500)
- **User-Friendly Messages** - Clear error messages for frontend display
- **Database Safety** - Transaction rollback and error recovery
- **Type Safety** - TypeScript validation for all data flows

## HTTP Status Codes

- **400 Bad Request** - Invalid input, validation failed, conflict
- **401 Unauthorized** - User not authenticated
- **403 Forbidden** - User authenticated but not authorized (e.g., self-join)
- **404 Not Found** - Resource does not exist
- **409 Conflict** - Match full, already joined, duplicate entry
- **500 Internal Server Error** - Database or server error

## Match Creation Validation

### Frontend Validation (`/app/matches/create/page.tsx`)
```
✓ Title: Required, non-empty, max 255 chars
✓ Description: Optional, max 1000 chars
✓ Max Players: Integer 2-100
✓ Initial Purse: Integer 100-1,000,000
✓ Agent: Required, must exist in database
✓ Response: Must be valid JSON with match.code
```

### API Validation (`/app/api/matches/route.ts`)
```
✓ User: Must be authenticated
✓ Title: Type string, non-empty, length validation
✓ Description: Type string if provided
✓ Max Players: Integer, range 2-100
✓ Initial Purse: Integer, range 100-1,000,000
✓ Agent ID/Name: Type string, non-empty
✓ Database: Error handling with rollback
✓ Player Insert: Fails match creation if error
```

## Match Join Validation

### API Validation (`/app/api/matches/[code]/route.ts`)
```
✓ Match Code: Required, alphanumeric
✓ Player ID: Required, non-empty string
✓ Player Name: Required, non-empty, max 255 chars
✓ Agent ID/Name: Required, type validated
✓ Self-Join: Returns 403 Forbidden
✓ Duplicate Join: Returns 400 Bad Request
✓ Match Full: Returns 409 Conflict
✓ Non-Existent: Returns 404 Not Found
```

## Error Message Format

### Database Errors (500)
```json
{
  "error": "Internal Server Error: [Generic message]"
}
```
Generic messages hide implementation details for security.

### Validation Errors (400)
```json
{
  "error": "Bad Request: [Specific validation failure]"
}
```
Specific messages help users correct input.

### Authorization Errors (401, 403, 404)
```json
{
  "error": "[HTTP] [Specific error]"
}
```

## Validation Utilities (`/lib/validation.ts`)

Reusable validators with consistent error handling:

```typescript
validateNonEmptyString(value, fieldName, maxLength)
validateInteger(value, fieldName, min, max)
validateUUID(value, fieldName)
validateUserId(value, fieldName)
validateMatchCode(value, fieldName)
validateEmail(value, fieldName)
validateEnum(value, fieldName, allowedValues)
validateArray(value, fieldName, minLength, maxLength)
```

All throw `ValidationError` with status code and error message.

## Error Recovery

### Match Creation Failure
1. Match inserted successfully
2. Player insertion fails
3. Automatic rollback: Delete match
4. Return error to user

### Join Match Failure
1. Validate match exists
2. Validate player eligibility
3. Validate not already joined
4. Validate match not full
5. If insert fails: Return 500, user can retry

## Frontend Error Display

All pages display errors in a user-friendly format:
```typescript
setError('User-friendly message')
// Error displayed in red error banner
// Allows user to understand and fix the issue
```

## Testing Error Handling

### Test Missing Fields
```bash
curl -X POST http://localhost:3000/api/matches \
  -H "Content-Type: application/json" \
  -d '{}' # Missing required fields
```
Expected: 400 Bad Request with specific field error

### Test Invalid Values
```bash
curl -X POST http://localhost:3000/api/matches \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "max_players": 0}'
```
Expected: 400 Bad Request with range validation error

### Test Self-Join Prevention
```bash
curl -X POST http://localhost:3000/api/matches/CODE \
  -H "Content-Type: application/json" \
  -d '{"player_id": "creator-id", ...}'
```
Expected: 403 Forbidden

### Test Non-Existent Resource
```bash
curl -X POST http://localhost:3000/api/matches/INVALID \
  -H "Content-Type: application/json" \
  -d '{...}'
```
Expected: 404 Not Found

## Best Practices

1. **Never silently fail** - Always return an error or success
2. **Validate early** - Check inputs at function entry
3. **Be specific (frontend)** - Help users fix input errors
4. **Be vague (backend)** - Hide implementation details
5. **Log everything** - Use `console.error('[v0]', ...)` for debugging
6. **Handle edge cases** - Check for null, undefined, invalid types
7. **Rollback changes** - Clean up on errors
8. **Use correct status codes** - Follow HTTP standards

## Future Improvements

- [ ] Rate limiting (429 Too Many Requests)
- [ ] Request logging and analytics
- [ ] Error aggregation and alerting
- [ ] Retry logic for transient failures
- [ ] Structured logging (JSON logs)
- [ ] APM integration (monitoring/tracing)
