import { useEffect, useState } from "react";
import { LockKeyhole, UnlockKeyhole } from "lucide-react";
import { chooseEquipmentOption, OPTIONS, type Slot } from "./model";
import { tierValue } from "./data/tiers";
export function NumberField({
  value,
  onChange,
  max = 1000000,
  integer = false,
  label,
  suffix,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
  integer?: boolean;
  label: string;
  suffix?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setError(false);
  }, [value]);
  return (
    <span className={`number-wrap ${error ? "input-error" : ""}`}>
      <input
        aria-label={label}
        title={
          error
            ? `0~${max} ${integer ? "정수" : "숫자"}를 입력해 주세요.`
            : label
        }
        aria-invalid={error}
        type="number"
        min="0"
        max={max}
        step={integer ? 1 : 0.01}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const n = Number(raw);
          const valid =
            raw !== "" &&
            Number.isFinite(n) &&
            n >= 0 &&
            n <= max &&
            (!integer || Number.isInteger(n));
          setError(!valid);
          if (valid) onChange(n);
        }}
        onBlur={() => {
          setDraft(String(value));
          setError(false);
        }}
      />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}

export function TierSelect({
  value,
  onChange,
  label,
  disabled = false,
  option,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
  option: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {!value && (
        <option value={0}>{option === "none" ? "—" : "단계 확인"}</option>
      )}
      {Array.from({ length: 15 }, (_, i) => (
        <option key={i} value={i + 1}>
          {i + 1}단계 - {tierValue(option, i + 1)?.toFixed(2) ?? "확인 필요"}%
        </option>
      ))}
    </select>
  );
}
export function SlotEditor({
  slot,
  onChange,
  label,
  usedOptions,
}: {
  slot: Slot;
  onChange: (s: Slot) => void;
  label: string;
  usedOptions: Slot["option"][];
}) {
  const inactive = slot.option === "none";
  return (
    <div className={`slot-row ${inactive ? "empty-slot" : ""}`}>
      <select
        aria-label={`${label} 옵션 종류`}
        className="option-select"
        value={slot.option}
        onChange={(e) => {
          const option = e.target.value as Slot["option"];
          onChange(chooseEquipmentOption(slot, option));
        }}
      >
        <option value="none">옵션 없음</option>
        {OPTIONS.map((o) => (
          <option
            key={o.id}
            value={o.id}
            disabled={usedOptions.includes(o.id) && o.id !== slot.option}
          >
            {o.short}
          </option>
        ))}
      </select>
      <TierSelect
        label={`${label} 단계`}
        option={slot.option}
        value={slot.tier}
        disabled={inactive}
        onChange={(tier) =>
          onChange({ ...slot, tier, value: tierValue(slot.option, tier)! })
        }
      />
      <button
        className={`icon-button lock ${slot.locked ? "is-locked" : ""}`}
        aria-label={`${label} ${slot.locked ? "잠금 해제" : "잠금"}`}
        aria-pressed={slot.locked}
        disabled={inactive}
        onClick={() => onChange({ ...slot, locked: !slot.locked })}
      >
        {slot.locked ? <LockKeyhole size={16} /> : <UnlockKeyhole size={16} />}
      </button>
    </div>
  );
}
