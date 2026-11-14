'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface BufferedNumberInputProps {
  value: number;
  onValueChange: (nextVal: number) => void;
  onEnterRun?: () => void;
  syncKey?: string | number;
  step?: number | string;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  style?: React.CSSProperties;
}

/**
 * 초저지연(Zero-Lag) 수치 입력 컴포넌트
 * - 타이핑 중 소수점("12."), 음수 부호("-"), 빈 문자열("")이 강제 형변환으로 깨지지 않도록 로컬 문자열 버퍼 유지
 * - 포커스 해제(Blur) 또는 Enter 입력 시 범위(min/max) 정규화 반영
 */
export default function BufferedNumberInput({
  value,
  onValueChange,
  onEnterRun,
  syncKey,
  step = 'any',
  min,
  max,
  placeholder,
  disabled,
  title,
  style,
}: BufferedNumberInputProps) {
  const formatNum = (n: number) => (Number.isFinite(n) ? String(n) : '0');
  const [text, setText] = useState<string>(() => formatNum(value));
  const focusedRef = useRef<boolean>(false);
  const lastSyncKeyRef = useRef<string | number | undefined>(syncKey);

  useEffect(() => {
    if (syncKey !== lastSyncKeyRef.current) {
      lastSyncKeyRef.current = syncKey;
      focusedRef.current = false;
      setText(formatNum(value));
      return;
    }
    if (!focusedRef.current) {
      setText(formatNum(value));
    }
  }, [value, syncKey]);

  const clampVal = (n: number): number => {
    let v = n;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return v;
  };

  const commitRaw = (raw: string): number => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
      const fallback = clampVal(0);
      onValueChange(fallback);
      setText(formatNum(fallback));
      return fallback;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setText(formatNum(value));
      return value;
    }
    const clamped = clampVal(parsed);
    onValueChange(clamped);
    setText(formatNum(clamped));
    return clamped;
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      onFocus={(e) => {
        focusedRef.current = true;
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        // 숫자와 부호, 소수점, 지수 표기만 허용
        if (raw !== '' && !/^-?\d*\.?\d*(?:[eE][+-]?\d*)?$/.test(raw)) {
          return;
        }
        setText(raw);
        if (raw !== '' && raw !== '-' && raw !== '.' && raw !== '-.' && !/[eE][+-]?$/.test(raw)) {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) {
            onValueChange(clampVal(parsed));
          }
        }
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        commitRaw(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitRaw(e.currentTarget.value);
          if (onEnterRun) {
            onEnterRun();
          }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const numStep = typeof step === 'number' ? step : Number(step);
          const delta = Number.isFinite(numStep) && numStep > 0 ? numStep : 1;
          const cur = Number(text);
          if (Number.isFinite(cur)) {
            e.preventDefault();
            const next = clampVal(Number((cur + (e.key === 'ArrowUp' ? delta : -delta)).toFixed(6)));
            setText(formatNum(next));
            onValueChange(next);
          }
        }
      }}
      style={style}
    />
  );
}
