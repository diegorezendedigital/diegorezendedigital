import PaginaLegal from "@/components/PaginaLegal";

export const metadata = { title: "Ajuda — Diego Rezende Digital" };

const perguntas: { p: string; r: string }[] = [
  { p: "O que é o Diego Rezende Digital?", r: "Um painel para vendedores de marketplace que mostra o lucro e a margem de cada venda, somando comissão, taxas, frete, impostos e o custo dos seus produtos." },
  { p: "Como conecto minha loja?", r: "No painel, abra Integrações, escolha o marketplace e clique em conectar. Você será levado ao site do marketplace para autorizar o acesso e depois volta ao sistema." },
  { p: "Que dados o sistema acessa?", r: "Pedidos, anúncios e valores cobrados pelo marketplace da loja que você autorizou. Usamos esses dados só para calcular o seu lucro. Detalhes na Política de Privacidade." },
  { p: "Como é calculado o lucro de cada venda?", r: "Valor da venda menos comissão e taxas do marketplace, frete pago por você, impostos e o custo do produto cadastrado por você. Os valores são estimativas e podem diferir do que o marketplace paga ao final." },
  { p: "Por que um pedido aparece sem custo?", r: "O lucro só fica completo depois que o custo do produto é informado. Você pode preencher o custo direto na aba de pedidos, e ele é reaproveitado nas próximas vendas do mesmo produto." },
  { p: "Como desconecto uma loja?", r: "Em Integrações, clique em desconectar na loja desejada. Isso encerra o nosso acesso aos dados dela." },
  { p: "Como peço a exclusão dos meus dados?", r: "Envie um e-mail para contato@diegorezendedigital.com.br pedindo a exclusão da conta e dos dados da loja. Atendemos pedidos de acesso, correção e exclusão previstos na LGPD." },
  { p: "Como falo com o suporte?", r: "Por e-mail: contato@diegorezendedigital.com.br." },
];

export default function Ajuda() {
  return (
    <PaginaLegal titulo="Central de ajuda" atualizado="15 de novembro de 2026">
      {perguntas.map((q) => (
        <div key={q.p}>
          <h2>{q.p}</h2>
          <p>{q.r}</p>
        </div>
      ))}
      <p>
        Veja também a <a className="underline" href="/privacidade">Política de Privacidade</a> e os <a className="underline" href="/termos">Termos de Uso</a>.
      </p>
    </PaginaLegal>
  );
}
