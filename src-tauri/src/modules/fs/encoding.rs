use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};

const SNIFF_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedText {
    pub content: String,
    pub encoding: &'static str,
    pub bom: bool,
}

fn decode_strict(encoding: &'static Encoding, bytes: &[u8]) -> Option<String> {
    encoding
        .decode_without_bom_handling_and_without_replacement(bytes)
        .map(|text| text.into_owned())
}

fn looks_like_text(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(SNIFF_BYTES)];
    if sample.is_empty() {
        return true;
    }
    let mut suspicious = 0usize;
    for &byte in sample {
        if byte == 0 {
            return false;
        }
        if byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte == 0x7f {
            suspicious += 1;
        }
    }
    suspicious * 100 <= sample.len() * 2
}

fn decoded_looks_text(text: &str) -> bool {
    let mut total = 0usize;
    let mut suspicious = 0usize;
    for ch in text.chars().take(SNIFF_BYTES) {
        total += 1;
        if ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t' {
            suspicious += 1;
        }
    }
    total == 0 || suspicious * 100 <= total * 2
}

fn detected_encoding(bytes: &[u8]) -> &'static Encoding {
    let mut detector = EncodingDetector::new(Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    detector.guess(None, Utf8Detection::Allow)
}

pub fn is_utf16_label(label: &str) -> bool {
    let normalized = label.trim().to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "utf-16le" | "utf-16-le" | "utf16le" | "utf-16be" | "utf-16-be" | "utf16be"
    )
}

/// Decodes a text file without trusting a label first. `hint` is used when the
/// user explicitly picks an encoding; otherwise common legacy encodings are
/// detected. Returns `None` for content that looks binary or cannot be decoded.
pub fn decode_text(bytes: &[u8], hint: Option<&str>) -> Option<DecodedText> {
    if bytes.is_empty() {
        return Some(DecodedText {
            content: String::new(),
            encoding: UTF_8.name(),
            bom: false,
        });
    }

    if let Some((encoding, bom_len)) = Encoding::for_bom(bytes) {
        if let Some(content) = decode_strict(encoding, &bytes[bom_len..]) {
            return Some(DecodedText {
                content,
                encoding: encoding.name(),
                bom: true,
            });
        }
    }

    if let Some(label) = hint {
        let encoding = Encoding::for_label_no_replacement(label.as_bytes())?;
        return decode_strict(encoding, bytes).map(|content| DecodedText {
            content,
            encoding: encoding.name(),
            bom: false,
        });
    }

    if !hint.map(is_utf16_label).unwrap_or(false) && !looks_like_text(bytes) {
        return None;
    }

    if let Ok(content) = std::str::from_utf8(bytes) {
        return Some(DecodedText {
            content: content.to_string(),
            encoding: UTF_8.name(),
            bom: false,
        });
    }

    let guessed = detected_encoding(bytes);
    for encoding in [
        guessed,
        encoding_rs::GB18030,
        encoding_rs::BIG5,
        encoding_rs::SHIFT_JIS,
    ] {
        if let Some(content) = decode_strict(encoding, bytes) {
            if decoded_looks_text(&content) {
                return Some(DecodedText {
                    content,
                    encoding: encoding.name(),
                    bom: false,
                });
            }
        }
    }

    None
}

pub fn encode_text(content: &str, label: Option<&str>, bom: bool) -> Result<Vec<u8>, String> {
    let encoding = match label {
        Some(label) => Encoding::for_label_no_replacement(label.as_bytes())
            .ok_or_else(|| format!("Unsupported encoding: {label}"))?,
        None => UTF_8,
    };
    let (encoded, _, had_errors) = encoding.encode(content);
    if had_errors {
        return Err(format!(
            "{} cannot represent all characters in this document",
            encoding.name()
        ));
    }

    let mut bytes = encoded.into_owned();
    if bom {
        let prefix: &[u8] = if encoding == UTF_8 {
            &[0xef, 0xbb, 0xbf]
        } else if encoding == UTF_16LE {
            &[0xff, 0xfe]
        } else if encoding == UTF_16BE {
            &[0xfe, 0xff]
        } else {
            &[]
        };
        if !prefix.is_empty() {
            bytes.splice(0..0, prefix.iter().copied());
        }
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_gbk_chinese() {
        let (bytes, _, had_errors) = encoding_rs::GBK.encode("中文测试");
        assert!(!had_errors);
        let decoded = decode_text(bytes.as_ref(), None).unwrap();
        assert_eq!(decoded.content, "中文测试");
        assert_eq!(decoded.encoding, "GBK");
        assert!(!decoded.bom);
    }

    #[test]
    fn decodes_utf16le_with_bom() {
        let mut bytes = vec![0xff, 0xfe];
        for unit in "中文".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let decoded = decode_text(&bytes, None).unwrap();
        assert_eq!(decoded.content, "中文");
        assert_eq!(decoded.encoding, "UTF-16LE");
        assert!(decoded.bom);
    }

    #[test]
    fn keeps_binary_binary() {
        assert_eq!(decode_text(&[0xff, 0xfe, 0xfd, 0xfc, 0x00], None), None);
    }

    #[test]
    fn encodes_gbk_round_trip() {
        let bytes = encode_text("中文测试", Some("gbk"), false).unwrap();
        let decoded = decode_text(&bytes, Some("gbk")).unwrap();
        assert_eq!(decoded.content, "中文测试");
        assert_eq!(decoded.encoding, "GBK");
    }

    #[test]
    fn encodes_utf8_bom_round_trip() {
        let bytes = encode_text("中文", Some("utf-8"), true).unwrap();
        assert_eq!(&bytes[..3], &[0xef, 0xbb, 0xbf]);
        let decoded = decode_text(&bytes, None).unwrap();
        assert_eq!(decoded.content, "中文");
        assert_eq!(decoded.encoding, "UTF-8");
        assert!(decoded.bom);
    }

    #[test]
    fn rejects_unrepresentable_characters() {
        assert!(encode_text("中文😀", Some("gbk"), false).is_err());
    }
}
