import { IconName } from "../../components/Icon";
import { CodeDelivery } from "../api";

/** Texto e ícone de cada forma de entrega do código, conforme o Telegram informou. */
export function describeDelivery(d: CodeDelivery, phone: string): { icon: IconName; title: string; body: string; label: string } {
  switch (d.method) {
    case "app":
      return {
        icon: "send",
        title: "Confira o app do Telegram",
        body: `Enviamos o código para o Telegram aberto em outro aparelho (celular ou computador), na conversa oficial “Telegram”. Ele não chega por SMS.`,
        label: "Código recebido no Telegram",
      };
    case "sms":
      return { icon: "message", title: "Confira suas mensagens", body: `Enviamos um SMS com o código para ${phone}.`, label: "Código do SMS" };
    case "sms_word":
      return {
        icon: "message",
        title: "Confira suas mensagens",
        body: `Enviamos um SMS para ${phone} com uma palavra${d.beginning ? ` que começa com “${d.beginning}”` : ""}.`,
        label: "Palavra recebida por SMS",
      };
    case "sms_phrase":
      return {
        icon: "message",
        title: "Confira suas mensagens",
        body: `Enviamos um SMS para ${phone} com uma frase${d.beginning ? ` que começa com “${d.beginning}”` : ""}.`,
        label: "Frase recebida por SMS",
      };
    case "call":
      return { icon: "phone", title: "Atenda a ligação", body: `O Telegram vai ligar para ${phone} e ditar o código.`, label: "Código ditado na ligação" };
    case "flash_call":
      return {
        icon: "phone",
        title: "Você vai receber uma ligação rápida",
        body: `Não precisa atender. Digite o número completo que ligou para ${phone}.`,
        label: "Número que ligou",
      };
    case "missed_call":
      return {
        icon: "phone",
        title: "Você vai receber uma chamada perdida",
        body: `Não precisa atender. O código são os últimos ${d.length ?? ""} dígitos do número que ligou${d.prefix ? ` (começa com ${d.prefix})` : ""}.`,
        label: "Últimos dígitos do número",
      };
    case "email":
      return {
        icon: "mail",
        title: "Confira seu e-mail",
        body: `O Telegram enviou o código para o e-mail de login ${d.email ? `(${d.email})` : "da sua conta"}.`,
        label: "Código do e-mail",
      };
    case "fragment":
      return {
        icon: "message",
        title: "Confira o Fragment",
        body: "Seu número é anônimo (Fragment): o código chega no app do Fragment.",
        label: "Código do Fragment",
      };
    default:
      return { icon: "message", title: "Digite o código", body: `O Telegram enviou um código para ${phone}.`, label: "Código" };
  }
}

export const NEXT_METHOD_LABEL: Record<string, string> = {
  sms: "por SMS",
  call: "por ligação",
  flash_call: "por ligação rápida",
  missed_call: "por chamada perdida",
  fragment: "pelo Fragment",
  other: "de outra forma",
};
