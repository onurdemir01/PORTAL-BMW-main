// src/components/self_service/SelfServiceItemModal.tsx — Self-Service katalog öğesi ekle/düzenle.
// Portal-geneli modal dili: ortak Modal (ikon+başlık+alt-metin+footer) + ui/Form kontrolleri
// (native <select> yerine stillendirilmiş Select) + tasarım tokenları.
import React, { useMemo, useState } from "react";
import { Squares2X2Icon } from "@heroicons/react/24/outline";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput, Textarea, Select, useFieldId } from "@/components/ui/Form";
import type { SelfServiceItem } from "@/types";

export default function SelfServiceItemModal({
  open,
  mode,
  draft,
  onClose,
  onSave,
}: {
  open: boolean;
  mode: "create" | "edit";
  draft: SelfServiceItem;
  onClose: () => void;
  onSave: (draft: SelfServiceItem) => void;
}) {
  const [d, setD] = useState<SelfServiceItem>(draft);

  React.useEffect(() => {
    setD(draft);
  }, [draft]);

  const header = useMemo(
    () => (mode === "create" ? "Yeni Öğe" : `Düzenle: ${draft.title || ""}`),
    [mode, draft.title]
  );

  const idTitle = useFieldId("title");
  const idInfo = useFieldId("info");
  const idGoUrl = useFieldId("goUrl");
  const idReq = useFieldId("requestExample");
  const idDetails = useFieldId("details");
  const idSampleType = useFieldId("sampleType");
  const idSampleValue = useFieldId("sampleValue");
  const idExtra = useFieldId("extra");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={header}
      subtitle="Zorunlu: Go URL, İstek Örneği, Örnek Değer"
      icon={Squares2X2Icon}
      size="xl"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">İptal</button>
          <button onClick={() => onSave(d)} className="btn-primary">Kaydet</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Başlık" htmlFor={idTitle} required>
          <TextInput id={idTitle} value={d.title} onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))} />
        </Field>

        <Field label="Bilgi" htmlFor={idInfo}>
          <Textarea id={idInfo} className="h-[90px]" value={d.info || ""} onChange={(e) => setD((x) => ({ ...x, info: e.target.value }))} />
        </Field>

        <Field label="Go URL" htmlFor={idGoUrl} required hint="confluence/… veya https://…">
          <TextInput id={idGoUrl} value={d.goUrl} onChange={(e) => setD((x) => ({ ...x, goUrl: e.target.value }))} placeholder="confluence/... or https://..." />
        </Field>

        <Field label="İstek Örneği" htmlFor={idReq} required>
          <Textarea id={idReq} className="h-[160px] font-mono text-xs" value={d.requestExample} onChange={(e) => setD((x) => ({ ...x, requestExample: e.target.value }))} />
        </Field>

        <Field label="Detaylar" htmlFor={idDetails}>
          <Textarea id={idDetails} className="h-[120px]" value={d.details || ""} onChange={(e) => setD((x) => ({ ...x, details: e.target.value }))} />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Örnek Tipi" htmlFor={idSampleType}>
            <Select
              id={idSampleType}
              value={d.sample.type}
              onChange={(e) => setD((x) => ({ ...x, sample: { ...x.sample, type: e.target.value as SelfServiceItem["sample"]["type"] } }))}
            >
              <option value="link">link</option>
              <option value="text">text</option>
            </Select>
          </Field>

          <div className="md:col-span-2">
            <Field label="Örnek Değer" htmlFor={idSampleValue} required>
              <TextInput
                id={idSampleValue}
                value={d.sample.value}
                onChange={(e) => setD((x) => ({ ...x, sample: { ...x.sample, value: e.target.value } }))}
                placeholder={d.sample.type === "link" ? "https://..." : "örnek metin"}
              />
            </Field>
          </div>
        </div>

        <Field label="Ek" htmlFor={idExtra}>
          <Textarea id={idExtra} className="h-[90px]" value={d.extra || ""} onChange={(e) => setD((x) => ({ ...x, extra: e.target.value }))} />
        </Field>
      </div>
    </Modal>
  );
}
