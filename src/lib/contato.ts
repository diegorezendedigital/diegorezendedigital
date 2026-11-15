// Contato comercial. Preencha o número do WhatsApp com DDI e DDD, só dígitos (ex.: "5541999999999").
// Enquanto estiver vazio, o botão do WhatsApp abre um e-mail para o contato.
export const WHATSAPP_NUMERO = "";
export const EMAIL_CONTATO = "contato@diegorezendedigital.com.br";

export function linkContato(mensagem: string): string {
  const texto = encodeURIComponent(mensagem);
  return WHATSAPP_NUMERO
    ? `https://wa.me/${WHATSAPP_NUMERO}?text=${texto}`
    : `mailto:${EMAIL_CONTATO}?subject=${encodeURIComponent("Calculadora de margem")}&body=${texto}`;
}
