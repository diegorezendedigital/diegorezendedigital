import Link from "next/link";

export default function RodapeLegal() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
      <Link href="/ajuda" className="hover:underline">Ajuda</Link>
      <Link href="/privacidade" className="hover:underline">Privacidade</Link>
      <Link href="/termos" className="hover:underline">Termos de uso</Link>
      <a href="mailto:contato@diegorezendedigital.com.br" className="hover:underline">contato@diegorezendedigital.com.br</a>
    </div>
  );
}
