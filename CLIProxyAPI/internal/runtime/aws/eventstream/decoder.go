package eventstream

import (
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"time"
)

const (
	DefaultMaxFrameSize = 16 << 20
	minFrameSize        = 16
)

var (
	ErrFrameTooLarge = errors.New("eventstream: frame too large")
	ErrInvalidFrame  = errors.New("eventstream: invalid frame")
	ErrInvalidCRC    = errors.New("eventstream: invalid crc")
)

type HeaderType byte

const (
	HeaderBoolTrue  HeaderType = 0
	HeaderBoolFalse HeaderType = 1
	HeaderByte      HeaderType = 2
	HeaderInt16     HeaderType = 3
	HeaderInt32     HeaderType = 4
	HeaderInt64     HeaderType = 5
	HeaderByteArray HeaderType = 6
	HeaderString    HeaderType = 7
	HeaderTimestamp HeaderType = 8
	HeaderUUID      HeaderType = 9
)

type Header struct {
	Type  HeaderType
	Value any
}

func (h Header) String() string {
	if value, ok := h.Value.(string); ok {
		return value
	}
	return ""
}

type Message struct {
	Headers map[string]Header
	Payload []byte
}

func (m Message) HeaderString(name string) string {
	if m.Headers == nil {
		return ""
	}
	return m.Headers[name].String()
}

type Decoder struct {
	r        io.Reader
	maxFrame uint32
}

func NewDecoder(r io.Reader) *Decoder {
	return NewDecoderWithMaxFrameSize(r, DefaultMaxFrameSize)
}

func NewDecoderWithMaxFrameSize(r io.Reader, maxFrame uint32) *Decoder {
	if maxFrame == 0 {
		maxFrame = DefaultMaxFrameSize
	}
	return &Decoder{r: r, maxFrame: maxFrame}
}

func (d *Decoder) Next() (Message, error) {
	if d == nil || d.r == nil {
		return Message{}, fmt.Errorf("%w: nil reader", ErrInvalidFrame)
	}
	prelude := make([]byte, 12)
	if _, err := io.ReadFull(d.r, prelude); err != nil {
		return Message{}, err
	}
	totalLen := binary.BigEndian.Uint32(prelude[0:4])
	headersLen := binary.BigEndian.Uint32(prelude[4:8])
	if err := validateLengths(totalLen, headersLen, d.maxFrame); err != nil {
		return Message{}, err
	}
	wantPreludeCRC := binary.BigEndian.Uint32(prelude[8:12])
	if got := crc32.ChecksumIEEE(prelude[:8]); got != wantPreludeCRC {
		return Message{}, fmt.Errorf("%w: prelude", ErrInvalidCRC)
	}

	rest := make([]byte, int(totalLen)-len(prelude))
	if _, err := io.ReadFull(d.r, rest); err != nil {
		return Message{}, err
	}
	frame := make([]byte, 0, int(totalLen))
	frame = append(frame, prelude...)
	frame = append(frame, rest...)
	wantMessageCRC := binary.BigEndian.Uint32(frame[len(frame)-4:])
	if got := crc32.ChecksumIEEE(frame[:len(frame)-4]); got != wantMessageCRC {
		return Message{}, fmt.Errorf("%w: message", ErrInvalidCRC)
	}
	return decodeValidatedFrame(frame, headersLen)
}

func DecodeFrame(frame []byte) (Message, error) {
	return DecodeFrameWithMaxFrameSize(frame, DefaultMaxFrameSize)
}

func DecodeFrameWithMaxFrameSize(frame []byte, maxFrame uint32) (Message, error) {
	if maxFrame == 0 {
		maxFrame = DefaultMaxFrameSize
	}
	if len(frame) < minFrameSize {
		return Message{}, fmt.Errorf("%w: too short", ErrInvalidFrame)
	}
	totalLen := binary.BigEndian.Uint32(frame[0:4])
	headersLen := binary.BigEndian.Uint32(frame[4:8])
	if err := validateLengths(totalLen, headersLen, maxFrame); err != nil {
		return Message{}, err
	}
	if int(totalLen) != len(frame) {
		return Message{}, fmt.Errorf("%w: length mismatch", ErrInvalidFrame)
	}
	wantPreludeCRC := binary.BigEndian.Uint32(frame[8:12])
	if got := crc32.ChecksumIEEE(frame[:8]); got != wantPreludeCRC {
		return Message{}, fmt.Errorf("%w: prelude", ErrInvalidCRC)
	}
	wantMessageCRC := binary.BigEndian.Uint32(frame[len(frame)-4:])
	if got := crc32.ChecksumIEEE(frame[:len(frame)-4]); got != wantMessageCRC {
		return Message{}, fmt.Errorf("%w: message", ErrInvalidCRC)
	}
	return decodeValidatedFrame(frame, headersLen)
}

func validateLengths(totalLen, headersLen, maxFrame uint32) error {
	if totalLen < minFrameSize {
		return fmt.Errorf("%w: total length below minimum", ErrInvalidFrame)
	}
	if totalLen > maxFrame {
		return ErrFrameTooLarge
	}
	if headersLen > totalLen-minFrameSize {
		return fmt.Errorf("%w: headers exceed frame", ErrInvalidFrame)
	}
	return nil
}

func decodeValidatedFrame(frame []byte, headersLen uint32) (Message, error) {
	headerStart := 12
	headerEnd := headerStart + int(headersLen)
	payloadEnd := len(frame) - 4
	headers, err := parseHeaders(frame[headerStart:headerEnd])
	if err != nil {
		return Message{}, err
	}
	payload := append([]byte(nil), frame[headerEnd:payloadEnd]...)
	return Message{Headers: headers, Payload: payload}, nil
}

func parseHeaders(raw []byte) (map[string]Header, error) {
	headers := make(map[string]Header)
	for offset := 0; offset < len(raw); {
		nameLen := int(raw[offset])
		offset++
		if nameLen == 0 || offset+nameLen > len(raw) {
			return nil, fmt.Errorf("%w: invalid header name", ErrInvalidFrame)
		}
		name := string(raw[offset : offset+nameLen])
		offset += nameLen
		if offset >= len(raw) {
			return nil, fmt.Errorf("%w: missing header type", ErrInvalidFrame)
		}
		headerType := HeaderType(raw[offset])
		offset++
		value, next, err := parseHeaderValue(headerType, raw, offset)
		if err != nil {
			return nil, err
		}
		offset = next
		headers[name] = Header{Type: headerType, Value: value}
	}
	return headers, nil
}

func parseHeaderValue(headerType HeaderType, raw []byte, offset int) (any, int, error) {
	switch headerType {
	case HeaderBoolTrue:
		return true, offset, nil
	case HeaderBoolFalse:
		return false, offset, nil
	case HeaderByte:
		if offset+1 > len(raw) {
			return nil, 0, fmt.Errorf("%w: truncated byte header", ErrInvalidFrame)
		}
		return int8(raw[offset]), offset + 1, nil
	case HeaderInt16:
		if offset+2 > len(raw) {
			return nil, 0, fmt.Errorf("%w: truncated int16 header", ErrInvalidFrame)
		}
		return int16(binary.BigEndian.Uint16(raw[offset : offset+2])), offset + 2, nil
	case HeaderInt32:
		if offset+4 > len(raw) {
			return nil, 0, fmt.Errorf("%w: truncated int32 header", ErrInvalidFrame)
		}
		return int32(binary.BigEndian.Uint32(raw[offset : offset+4])), offset + 4, nil
	case HeaderInt64:
		if offset+8 > len(raw) {
			return nil, 0, fmt.Errorf("%w: truncated int64 header", ErrInvalidFrame)
		}
		return int64(binary.BigEndian.Uint64(raw[offset : offset+8])), offset + 8, nil
	case HeaderByteArray:
		return parseLengthPrefixedBytes(raw, offset)
	case HeaderString:
		value, next, err := parseLengthPrefixedBytes(raw, offset)
		if err != nil {
			return nil, 0, err
		}
		return string(value.([]byte)), next, nil
	case HeaderTimestamp:
		if offset+8 > len(raw) {
			return nil, 0, fmt.Errorf("%w: truncated timestamp header", ErrInvalidFrame)
		}
		millis := int64(binary.BigEndian.Uint64(raw[offset : offset+8]))
		return time.UnixMilli(millis).UTC(), offset + 8, nil
	case HeaderUUID:
		if offset+16 > len(raw) {
			return nil, 0, fmt.Errorf("%w: truncated uuid header", ErrInvalidFrame)
		}
		value := append([]byte(nil), raw[offset:offset+16]...)
		return value, offset + 16, nil
	default:
		return nil, 0, fmt.Errorf("%w: unknown header type %d", ErrInvalidFrame, headerType)
	}
}

func parseLengthPrefixedBytes(raw []byte, offset int) (any, int, error) {
	if offset+2 > len(raw) {
		return nil, 0, fmt.Errorf("%w: truncated length-prefixed header", ErrInvalidFrame)
	}
	length := int(binary.BigEndian.Uint16(raw[offset : offset+2]))
	offset += 2
	if offset+length > len(raw) {
		return nil, 0, fmt.Errorf("%w: truncated length-prefixed value", ErrInvalidFrame)
	}
	return append([]byte(nil), raw[offset:offset+length]...), offset + length, nil
}
