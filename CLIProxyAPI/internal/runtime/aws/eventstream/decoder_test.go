package eventstream

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"io"
	"testing"
)

func encodeTestFrame(t *testing.T, headers map[string]string, payload []byte) []byte {
	t.Helper()
	var headerBytes []byte
	for name, value := range headers {
		headerBytes = append(headerBytes, byte(len(name)))
		headerBytes = append(headerBytes, []byte(name)...)
		headerBytes = append(headerBytes, byte(HeaderString))
		var length [2]byte
		binary.BigEndian.PutUint16(length[:], uint16(len(value)))
		headerBytes = append(headerBytes, length[:]...)
		headerBytes = append(headerBytes, []byte(value)...)
	}

	totalLen := 12 + len(headerBytes) + len(payload) + 4
	frame := make([]byte, totalLen)
	binary.BigEndian.PutUint32(frame[0:4], uint32(totalLen))
	binary.BigEndian.PutUint32(frame[4:8], uint32(len(headerBytes)))
	binary.BigEndian.PutUint32(frame[8:12], crc32.ChecksumIEEE(frame[:8]))
	copy(frame[12:], headerBytes)
	copy(frame[12+len(headerBytes):], payload)
	binary.BigEndian.PutUint32(frame[len(frame)-4:], crc32.ChecksumIEEE(frame[:len(frame)-4]))
	return frame
}

func TestDecodeFrameValid(t *testing.T) {
	frame := encodeTestFrame(t, map[string]string{":event-type": "assistantResponseEvent"}, []byte(`{"content":"hello"}`))
	msg, err := DecodeFrame(frame)
	if err != nil {
		t.Fatalf("DecodeFrame: %v", err)
	}
	if msg.HeaderString(":event-type") != "assistantResponseEvent" {
		t.Fatalf("event type = %q", msg.HeaderString(":event-type"))
	}
	if string(msg.Payload) != `{"content":"hello"}` {
		t.Fatalf("payload = %s", msg.Payload)
	}
}

func TestDecoderReadsMultipleFrames(t *testing.T) {
	first := encodeTestFrame(t, map[string]string{":event-type": "assistantResponseEvent"}, []byte(`{"content":"a"}`))
	second := encodeTestFrame(t, map[string]string{":event-type": "messageStopEvent"}, []byte(`{}`))
	decoder := NewDecoder(bytes.NewReader(append(first, second...)))

	msg, err := decoder.Next()
	if err != nil {
		t.Fatalf("first Next: %v", err)
	}
	if msg.HeaderString(":event-type") != "assistantResponseEvent" {
		t.Fatalf("first event = %q", msg.HeaderString(":event-type"))
	}

	msg, err = decoder.Next()
	if err != nil {
		t.Fatalf("second Next: %v", err)
	}
	if msg.HeaderString(":event-type") != "messageStopEvent" {
		t.Fatalf("second event = %q", msg.HeaderString(":event-type"))
	}

	if _, err = decoder.Next(); !errors.Is(err, io.EOF) {
		t.Fatalf("third Next err = %v, want EOF", err)
	}
}

func TestDecodeFrameRejectsTruncatedFrame(t *testing.T) {
	frame := encodeTestFrame(t, map[string]string{":event-type": "assistantResponseEvent"}, []byte(`{}`))
	_, err := DecodeFrame(frame[:len(frame)-1])
	if !errors.Is(err, ErrInvalidFrame) {
		t.Fatalf("err = %v, want ErrInvalidFrame", err)
	}
}

func TestDecodeFrameRejectsInvalidLength(t *testing.T) {
	frame := encodeTestFrame(t, map[string]string{":event-type": "assistantResponseEvent"}, []byte(`{}`))
	binary.BigEndian.PutUint32(frame[0:4], 8)
	binary.BigEndian.PutUint32(frame[8:12], crc32.ChecksumIEEE(frame[:8]))
	_, err := DecodeFrame(frame)
	if !errors.Is(err, ErrInvalidFrame) {
		t.Fatalf("err = %v, want ErrInvalidFrame", err)
	}
}

func TestDecodeFrameRejectsOversizedFrame(t *testing.T) {
	frame := encodeTestFrame(t, map[string]string{":event-type": "assistantResponseEvent"}, []byte(`{}`))
	_, err := DecodeFrameWithMaxFrameSize(frame, uint32(len(frame)-1))
	if !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("err = %v, want ErrFrameTooLarge", err)
	}
}

func TestDecodeFrameRejectsInvalidCRC(t *testing.T) {
	frame := encodeTestFrame(t, map[string]string{":event-type": "assistantResponseEvent"}, []byte(`{}`))
	frame[len(frame)-1] ^= 0xff
	_, err := DecodeFrame(frame)
	if !errors.Is(err, ErrInvalidCRC) {
		t.Fatalf("err = %v, want ErrInvalidCRC", err)
	}
}

func TestDecodeFrameAllowsUnknownEventType(t *testing.T) {
	frame := encodeTestFrame(t, map[string]string{":event-type": "futureEvent"}, []byte(`{"x":1}`))
	msg, err := DecodeFrame(frame)
	if err != nil {
		t.Fatalf("DecodeFrame: %v", err)
	}
	if msg.HeaderString(":event-type") != "futureEvent" {
		t.Fatalf("event type = %q", msg.HeaderString(":event-type"))
	}
}
