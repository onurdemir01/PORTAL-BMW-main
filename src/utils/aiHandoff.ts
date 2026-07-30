// src/utils/aiHandoff.ts — AI Analist'e sohbet-modu köprüsü
//
// Performance/Dashboard gibi sayfalardaki "AI ile analiz et" butonları bu
// tek yolu paylaşır: sessionStorage'a seed mesajını yazıp /ai-analyst'e
// yönlendirir. AiAnalystPage.tsx bunu `aiAnalystChatPrefill` anahtarıyla okur
// (bkz. o dosyadaki useEffect) ve sohbeti otomatik başlatır.
import type { NavigateFunction } from "react-router-dom";

export function seedAiAnalystChat(navigate: NavigateFunction, prompt: string): void {
  sessionStorage.setItem("aiAnalystChatPrefill", prompt);
  navigate("/ai-analyst");
}
