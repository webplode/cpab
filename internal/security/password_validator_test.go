package security

import "testing"

func TestValidatePassword(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{name: "empty", input: "", wantErr: "password must be at least 8 characters long"},
		{name: "too short", input: "abc1234", wantErr: "password must be at least 8 characters long"},
		{name: "letters only", input: "abcdefgh", wantErr: "password must include at least one digit"},
		{name: "digits only", input: "12345678", wantErr: "password must include at least one letter"},
		{name: "ascii mixed", input: "abc12345"},
		{name: "unicode mixed", input: "密碼安全1234"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			err := ValidatePassword(tc.input)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("ValidatePassword(%q) error = %v, want nil", tc.input, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("ValidatePassword(%q) error = nil, want %q", tc.input, tc.wantErr)
			}
			if err.Error() != tc.wantErr {
				t.Fatalf("ValidatePassword(%q) error = %q, want %q", tc.input, err.Error(), tc.wantErr)
			}
		})
	}
}
