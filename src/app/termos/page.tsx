import PaginaLegal from "@/components/PaginaLegal";

export const metadata = { title: "Termos de Uso — Diego Rezende Digital" };

export default function Termos() {
  return (
    <PaginaLegal titulo="Termos de Uso" atualizado="15 de novembro de 2026">
      <p>Ao usar o Diego Rezende Digital, você concorda com estes termos.</p>

      <h2>1. O serviço</h2>
      <p>
        O sistema é um painel para vendedores de marketplace que importa pedidos e anúncios das lojas conectadas e calcula lucro, margem e preço de venda a partir dos dados do marketplace e das informações que você cadastra.
      </p>

      <h2>2. Conta e conexão de lojas</h2>
      <ul>
        <li>Você é responsável pelas informações da sua conta e por manter o acesso seguro.</li>
        <li>Ao conectar uma loja, você autoriza o sistema a acessar os dados dela pelas permissões que o marketplace concede. Você pode revogar essa autorização a qualquer momento.</li>
        <li>Você declara ter direito de conectar as lojas que adicionar.</li>
      </ul>

      <h2>3. Uso adequado</h2>
      <p>É proibido usar o sistema para fins ilegais, tentar acessar dados de outros usuários ou interferir no funcionamento do serviço.</p>

      <h2>4. Precisão dos cálculos</h2>
      <p>
        Os valores exibidos dependem dos dados enviados pelo marketplace e das informações cadastradas por você, como custos e impostos. São estimativas de apoio à decisão e podem diferir dos valores finais pagos pelo marketplace. Confira os resultados antes de tomar decisões financeiras.
      </p>

      <h2>5. Disponibilidade</h2>
      <p>Buscamos manter o serviço disponível, mas ele pode sofrer interrupções, e também depende da disponibilidade das plataformas de marketplace.</p>

      <h2>6. Limitação de responsabilidade</h2>
      <p>Na medida permitida pela lei, não nos responsabilizamos por perdas decorrentes de decisões tomadas com base nas informações do sistema ou de falhas nas plataformas de terceiros.</p>

      <h2>7. Privacidade</h2>
      <p>O tratamento de dados segue a nossa Política de Privacidade, disponível em /privacidade.</p>

      <h2>8. Alterações e contato</h2>
      <p>Podemos atualizar estes termos, e a data de atualização fica no topo da página. Dúvidas: contato@diegorezendedigital.com.br.</p>
    </PaginaLegal>
  );
}
