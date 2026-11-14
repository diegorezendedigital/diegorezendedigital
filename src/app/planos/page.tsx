import { redirect } from "next/navigation";

// Assinatura fica para depois: por enquanto a página de planos leva à calculadora gratuita.
export default function PlanosPage() {
  redirect("/calculadora-gratis");
}
