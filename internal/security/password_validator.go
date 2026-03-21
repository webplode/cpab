package security

import (
	"fmt"
	"unicode"
	"unicode/utf8"
)

// ValidatePassword enforces the shared password complexity policy.
func ValidatePassword(password string) error {
	if utf8.RuneCountInString(password) < 8 {
		return fmt.Errorf("password must be at least 8 characters long")
	}

	hasLetter := false
	hasDigit := false
	for _, r := range password {
		if unicode.IsLetter(r) {
			hasLetter = true
		}
		if unicode.IsDigit(r) {
			hasDigit = true
		}
		if hasLetter && hasDigit {
			return nil
		}
	}

	if !hasLetter {
		return fmt.Errorf("password must include at least one letter")
	}
	if !hasDigit {
		return fmt.Errorf("password must include at least one digit")
	}
	return nil
}
