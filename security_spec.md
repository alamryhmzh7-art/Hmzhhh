# Firebase Security Specification - HAMZA OBD PRO

This document outlines the security invariants, rogue payloads (The "Dirty Dozen"), and validation strategies to secure user diagnostic data and preferences.

## 1. Data Invariants

1.  **Strict Ownership**: A user's preferences (`/users/{userId}/preferences/settings`) can only be read, created, or updated by the matching authenticated user whose `request.auth.uid == userId`.
2.  **Report Owner Restrictions**: A diagnostic report (`/users/{userId}/diagnosticHistory/{reportId}`) is strictly private. Only the matching `userId` can read, create, or delete a report. No cross-user access is permitted.
3.  **No Anonymous Registrations**: Standard operations require an authenticated, verified user account (`request.auth.token.email_verified == true`).
4.  **Temporal Integrity**: Timestamps (`updatedAt` and `timestamp`) must match `request.time` exactly to prevent historic fraud.
5.  **Schema Hardening**: Document IDs and properties must conform strictly to expected regular expressions and types.

---

## 2. The "Dirty Dozen" Payloads (Rogue Tests)

Below are twelve malicious payloads designed to attempt privilege escalation, ID poisoning, timestamp spoofing, or data corruption:

### Case 1: ID Poisoning (Junk Character Inject)
*   **Path**: `/users/invalid@@@characters###/preferences/settings`
*   **Attack**: Attacker attempts to poison the user ID path with malicious character sets.
*   **Expected Outcome**: `PERMISSION_DENIED` (ID verification fails).

### Case 2: Cross-User Read (Infiltration)
*   **Path**: `/users/victim_user_123/preferences/settings` (Authenticated as `attacker_456`)
*   **Attack**: Attacker attempts to fetch another user's OBD settings.
*   **Expected Outcome**: `PERMISSION_DENIED`.

### Case 3: Cross-User Write (Spoofing)
*   **Path**: `/users/victim_user_123/preferences/settings` (Authenticated as `attacker_456`)
*   **Attack**: Attacker attempts to modify victim's connection details.
*   **Expected Outcome**: `PERMISSION_DENIED`.

### Case 4: Missing Required Key on Creation
*   **Path**: `/users/user_123/preferences/settings`
*   **Payload**: `{ "userId": "user_123", "theme": "dark" }` (Missing `language`, `units`, and `transportType`)
*   **Expected Outcome**: `PERMISSION_DENIED` (Schema requirement fails).

### Case 5: Shadow Field / Ghost Field Injection
*   **Path**: `/users/user_123/preferences/settings`
*   **Payload**: `{ "userId": "user_123", "language": "en", "theme": "dark", "units": "metric", "transportType": "WIFI_TCP", "isAdmin": true }` (Injecting a ghost privilege key)
*   **Expected Outcome**: `PERMISSION_DENIED` (Keys list mismatch size / hasOnly).

### Case 6: Unverified Email Login Bypass
*   **Path**: `/users/user_123/preferences/settings` (Authenticated as `user_123` but `email_verified == false`)
*   **Attack**: Unverified email attempts write.
*   **Expected Outcome**: `PERMISSION_DENIED`.

### Case 7: VIN Format Poisoning (Invalid Structure)
*   **Path**: `/users/user_123/diagnosticHistory/rep_789`
*   **Payload**: `{ "id": "rep_789", "userId": "user_123", "timestamp": "2026-09-01T15:00:00Z", "rawVin": "SHORT_VIN", "dtcCodes": [] }`
*   **Expected Outcome**: `PERMISSION_DENIED` (VIN pattern or size check fails).

### Case 8: Maliciously Oversized String in Report
*   **Path**: `/users/user_123/diagnosticHistory/rep_789`
*   **Payload**: `{ "id": "rep_789", "userId": "user_123", "timestamp": "2026-09-01T15:00:00Z", "rawVin": "4T1BF1FK5NU123456", "dtcCodes": [], "manufacturer": "VERY_LONG_STRING_OVER_10KB_..." }`
*   **Expected Outcome**: `PERMISSION_DENIED` (String length exceeded).

### Case 9: Array Type Pollution (Injecting Objects into String Array)
*   **Path**: `/users/user_123/diagnosticHistory/rep_789`
*   **Payload**: `{ "id": "rep_789", "userId": "user_123", "timestamp": "2026-09-01T15:00:00Z", "rawVin": "4T1BF1FK5NU123456", "dtcCodes": [{"isObject": true}] }`
*   **Expected Outcome**: `PERMISSION_DENIED` (Array contents must be string).

### Case 10: Client-side Timestamp Spoofing (Backdating)
*   **Path**: `/users/user_123/preferences/settings`
*   **Payload**: `{ "userId": "user_123", "language": "en", "theme": "dark", "units": "metric", "transportType": "WIFI_TCP", "updatedAt": "2010-01-01T00:00:00Z" }`
*   **Expected Outcome**: `PERMISSION_DENIED` (Must equal server `request.time`).

### Case 11: Diagnostic Report Cross-User Hijack
*   **Path**: `/users/victim_123/diagnosticHistory/rep_456` (Authenticated as `attacker_789`)
*   **Attack**: Maliciously write or overwrite a diagnostic report.
*   **Expected Outcome**: `PERMISSION_DENIED`.

### Case 12: Terminal State Status Bypass
*   **Path**: `/users/user_123/diagnosticHistory/rep_456`
*   **Payload**: Attempting to alter a previously finalized scan history report (Reports are immutable).
*   **Expected Outcome**: `PERMISSION_DENIED`.
