import PaginaLegal from "@/components/PaginaLegal";

export const metadata = { title: "Política de Privacidade — Diego Rezende Digital" };

export default function Privacidade() {
  return (
    <PaginaLegal titulo="Política de Privacidade" atualizado="19 de novembro de 2026">
      <p>
        Esta política explica como o Diego Rezende Digital (&quot;nós&quot;) trata os dados dos vendedores que usam o sistema e das lojas que eles conectam, incluindo Mercado Livre, Shopee e TikTok Shop, em conformidade com a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).
      </p>

      <h2>1. Dados que tratamos</h2>
      <ul>
        <li>Dados da conta: nome, e-mail e dados de acesso ao sistema.</li>
        <li>Dados das lojas conectadas: identificação da loja, anúncios, preços e estoque.</li>
        <li>Dados de pedidos: itens, valores, taxas, frete, status, data e estado de entrega. Podemos receber dados pessoais de compradores que fazem parte do pedido; usamos apenas o necessário para o cálculo de lucro.</li>
        <li>Dados financeiros do marketplace: tarifas, repasses e liquidações por pedido.</li>
        <li>Informações que você cadastra: custo dos produtos, impostos e regras de preço.</li>
        <li>Tokens de autorização fornecidos pelo marketplace, guardados de forma protegida.</li>
      </ul>

      <h2>2. Para que usamos</h2>
      <ul>
        <li>Calcular lucro, margem e preço de venda de cada pedido e anúncio.</li>
        <li>Exibir relatórios e painéis ao próprio vendedor.</li>
        <li>Manter o funcionamento, a segurança e o suporte do sistema.</li>
      </ul>
      <p>Não vendemos dados, não usamos dados de compradores para publicidade e não os compartilhamos com terceiros para fins de marketing.</p>

      <h2>3. Compartilhamento</h2>
      <p>
        Os dados ficam acessíveis apenas ao vendedor titular da conta. Usamos provedores de infraestrutura (hospedagem e banco de dados) que tratam os dados em nosso nome e sob obrigação de confidencialidade. Podemos divulgar dados se houver obrigação legal.
      </p>

      <h2>4. Armazenamento e segurança</h2>
      <p>
        Os dados são armazenados em banco de dados com controle de acesso por conta, e a comunicação é feita por conexão criptografada. Mantemos os dados enquanto a conta estiver ativa e pelo prazo necessário para cumprir obrigações legais.
      </p>

      <h2>5. Desconexão e exclusão</h2>
      <p>
        Você pode desconectar uma loja a qualquer momento no sistema, o que encerra o acesso aos dados dela. Também pode solicitar a exclusão da conta e dos dados pelo e-mail abaixo.
      </p>

      <h2>6. Seus direitos</h2>
      <p>
        Nos termos da LGPD, você pode pedir confirmação do tratamento, acesso, correção, portabilidade, anonimização ou exclusão dos seus dados, e revogar consentimentos.
      </p>

      <h2>7. Incidentes de segurança</h2>
      <p>
        O responsável pela segurança e pela privacidade dos dados é Diego Rezende (encarregado). Qualquer pessoa pode comunicar uma suspeita de incidente
        ou vulnerabilidade pelo e-mail contato@diegorezendedigital.com.br, com o assunto &quot;Incidente de segurança&quot;. Ao identificar um incidente, nós o
        investigamos imediatamente, revogamos e trocamos credenciais e tokens afetados, e avisamos os vendedores afetados e o marketplace envolvido
        (Mercado Livre, Shopee ou TikTok Shop) sem demora indevida e em até 72 horas após a confirmação. Quando a lei exigir, comunicamos também a
        Autoridade Nacional de Proteção de Dados (ANPD). Cada incidente é registrado com causa, impacto e ações corretivas.
      </p>

      <h2>8. Atualização desta política</h2>
      <p>Revisamos esta política pelo menos uma vez por ano e sempre que o serviço mudar de forma relevante. A data da última atualização aparece no topo da página.</p>

      <h2>9. Contato</h2>
      <p>Para dúvidas ou pedidos sobre seus dados: contato@diegorezendedigital.com.br.</p>
    </PaginaLegal>
  );
}
