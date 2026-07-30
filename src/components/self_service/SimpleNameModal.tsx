// src/components/self_service/SimpleNameModal.tsx — Basit "ad" giriş modalı (grup/öğe adı vb.).
// Ortak Modal + ui/Form dili; Enter ile kaydet.
import React, { useEffect, useState } from "react";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput, useFieldId } from "@/components/ui/Form";

export default function SimpleNameModal({
  open,
  title,
  initialValue,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initialValue: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [v, setV] = useState("");
  const id = useFieldId("name");

  useEffect(() => {
    setV(initialValue || "");
  }, [initialValue]);

  const canSave = v.trim().length > 0;
  const save = () => { if (canSave) onSave(v.trim()); };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Ad zorunludur."
      icon={PencilSquareIcon}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">İptal</button>
          <button onClick={save} disabled={!canSave} className="btn-primary">Kaydet</button>
        </>
      }
    >
      <Field label="Ad" htmlFor={id} required error={!canSave ? null : undefined}>
        <TextInput
          id={id}
          value={v}
          autoFocus
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
      </Field>
    </Modal>
  );
}
