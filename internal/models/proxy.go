package models

import "time"

// Proxy represents an upstream proxy endpoint.
type Proxy struct {
	ID       uint64 `gorm:"primaryKey;autoIncrement"` // Primary key.
	ProxyURL string `gorm:"type:text;not null"`       // Proxy URL.

	IsActive      bool       `gorm:"not null;default:true"`            // Whether this proxy is eligible for assignment.
	TestStatus    string     `gorm:"type:text;not null;default:'new'"` // Last explicit test status.
	LastTestedAt  *time.Time // Last explicit test timestamp.
	LastError     string     `gorm:"type:text"` // Last explicit test error, if any.
	LastCheckedIP string     `gorm:"type:text"` // Last observed egress IP, if any.

	CreatedAt time.Time `gorm:"not null;autoCreateTime"` // Creation timestamp.
	UpdatedAt time.Time `gorm:"not null;autoUpdateTime"` // Last update timestamp.
}
