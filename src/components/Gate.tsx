// src/components/Gate.tsx — Dinamik görünürlük için buton/tab/bölüm seviyesinde sarmalayıcı.
//
// Kullanım:
//   <Gate element="btn:logx:cancel"><button …/></Gate>   // görünmezse hiç render edilmez
//   const canCancel = useCanSee("btn:logx:cancel");        // koşullu mantık için
//
// Karar tamamen AuthContext.canSee'ye (per-user çözülmüş element haritası) devredilir —
// sunucu tarafı da aynı element anahtarıyla gerçekten reddeder (bkz. requireVisible, Faz 3).
// Registry'de OLMAYAN anahtar varsayılan GÖRÜNÜR sayılır (kayıtsız öğeyi kazara gizlememek
// için); admin öğeyi registry'ye ekleyip kapatınca her yerde (dashboard/nav/buton) kaybolur.
import React from "react";
import { useAuth } from "@/contexts/AuthContext";

export function useCanSee(elementKey: string): boolean {
  const { canSee } = useAuth();
  return canSee(elementKey);
}

export const Gate: React.FC<{
  element: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ element, children, fallback = null }) => {
  const visible = useCanSee(element);
  return <>{visible ? children : fallback}</>;
};

export default Gate;
