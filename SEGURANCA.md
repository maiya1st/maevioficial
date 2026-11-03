# MAÉVI · revisão de segurança 0.5.0

Data: 03/11/2026. Node.js verificado: 24.22.1. Escopo: código local da vitrine, checkout, painel, API, SQLite, fotos, reservas, cupons e backup.

## Resultado

**60 resultados aprovados, zero falhas e zero testes ignorados**, na contagem do runner Node. Os testes do provedor usam respostas locais simuladas, sem transações externas. Sintaxe dos arquivos de aplicação e correspondência dos seletores principais com o HTML também verificadas.

```powershell
node --test backend.test.cjs security.test.cjs catalog.test.cjs commerce.test.cjs http.test.cjs payments.test.cjs
```

A versão está pronta para testes locais e para a próxima etapa de integração. A revisão não é garantia de ausência de vulnerabilidades nem autorização para publicar esta configuração de desenvolvimento como loja real.

## Proteções verificadas

| Área | Proteção e evidência |
| --- | --- |
| Painel | Chave aleatória de desenvolvimento; sessão com identificador aleatório, hash no servidor, cookie HttpOnly/SameSite=Strict; rejeição de sessão ausente/forjada |
| Sessão | Expiração após 30 minutos inativos ou oito horas totais, renovação ao entrar, limite de 32 sessões, invalidação no logout e limpeza de dados na interface |
| Respostas atrasadas | Uma resposta anterior à saída do painel não restaura os dados após logout; operações adicionais usam geração para descartar respostas antigas |
| CSRF e origem | Cabeçalho próprio em escritas, Origin exato incluindo porta, verificação de Fetch Metadata, Host restrito e nenhum CORS aberto |
| Banco | SQL com parâmetros; tabelas novas adicionadas sem apagar dados existentes; bloqueio de arquivos SQLite e da chave pelo servidor HTTP |
| Checkout | Preço e total calculados no servidor; dados do cliente não aprovam pagamento; cotação com total/condições alterados precisa ser conferida novamente |
| Estoque | Reserva e pedido na mesma transação; proteção da última unidade e idempotência de tentativas |
| Cupons | Percentual, valor mínimo, validade, ativação e limite de usos validados no servidor; disputa pelo último uso não ultrapassa o limite |
| Expiração e cancelamento | Liberação de estoque/cupom uma vez; reconsulta do estado dentro da transação de cancelamento; pedidos iniciados no painel não expiram como reservas recebidas |
| Consulta do pedido | Número sozinho não revela dados; exige chave privada em cabeçalho. Chave em parâmetro de URL não autentica |
| Conteúdo | Escape de texto no HTML, campos tipados e limitados; bloqueio de URLs executáveis e atributos injetados |
| HTTP | Limites de cabeçalhos, corpo JSON, conexões, tempo de requisição/inatividade e taxa de chamadas; parser rejeita Content-Length com Transfer-Encoding |
| Navegador | CSP, proibição de scripts/eventos inline e objetos, nosniff, bloqueio de enquadramento, isolamento de origem e restrição de permissões sensíveis |
| Cache | HTML, API e erros sem armazenamento; nenhuma credencial em arquivos públicos ou no ZIP |
| Atividades | Registro protegido, com data, ação, entidade e ID; sem nome, e-mail, telefone, endereço, chave ou token |
| Backup | Snapshot consistente do SQLite por VACUUM INTO, quick_check da cópia, fotos, chave e manifesto com hash; pasta privada bloqueada no HTTP |

## Correção encontrada no transporte HTTP real

Um teste com Content-Length excessivo revelou que, depois de responder 413, a conexão podia continuar aguardando o corpo declarado e prejudicar a próxima requisição reutilizada pelo agente HTTP. As respostas de erro agora enviam **Connection: close**. O teste verifica o cabeçalho e executa um upload autenticado na sequência; passou após a correção.

O envio de um corpo acima do limite em streaming pode causar encerramento da conexão em vez de uma resposta JSON legível. O limite continua aplicado e o cliente trata a falha de conexão sem considerar o pedido confirmado.

## Consulta de CEP

- Somente CEPs numéricos com oito dígitos são aceitos; sequências repetidas são rejeitadas.
- O host é fixo: HTTPS do ViaCEP. Não se aceita URL do cliente nem redirecionamento externo.
- A requisição envia somente o CEP, sem nome, e-mail, telefone ou número do endereço.
- Timeout de sete segundos, resposta limitada a 16 KiB, cache limitado a 500 CEPs e limite de consultas por endereço.
- Apenas rua, bairro, cidade, UF e CEP validados são retornados. Falhas não expõem detalhes internos e o preenchimento manual continua disponível.

O serviço real foi consultado no navegador durante um teste com o CEP público de referência 01001000. Os testes automatizados do serviço usam respostas simuladas, sem carga sobre a API externa.

## Upload de imagens

- Exige sessão administrativa, cabeçalho próprio, origem válida e limite de chamadas.
- Limite de 4 MB por arquivo, 40 megapixels e 10.000 pixels por lado.
- Aceita somente JPG, PNG e WebP, com inspeção estrutural e de dimensões. SVG, HTML, MIME incompatível e arquivos truncados dos cenários testados foram rejeitados.
- O nome original não é usado: nomes aleatórios são gerados no servidor. Não é possível escolher um caminho de escrita pela requisição.
- Cota de 100 MB ou 400 arquivos enviados, por pasta de assets. O servidor não executa nem converte os arquivos.
- Assets públicos têm caminhos e extensões permitidos, MIME fixado e bloqueio de links simbólicos que escapem do caminho esperado.

A inspeção estrutural não é antivírus nem uma decodificação completa de todos os formatos. Metadados EXIF/XMP não são removidos automaticamente; revise as fotos reais e seus metadados antes de publicá-las. Fotos substituídas não são excluídas automaticamente.

Upload válido foi confirmado em teste isolado e em HTTP real, com imagem servida depois. A tentativa pelo seletor visual de arquivos ficou bloqueada e a sessão expirou durante a espera; não se atribui aprovação a esse teste visual. Nenhuma foto real do catálogo foi substituída por esse teste.

## Verificação no navegador

Foram conferidos: seleção de tamanho, sacola, checkout em três etapas, consulta de CEP, entrega e retirada, resumo, aplicação de cupom, criação do pedido e cancelamento. No painel, login, cadastro de cupom e salvamento de configurações foram verificados. O total foi observado fixo no resumo de computador e antes da confirmação em viewport de 390 px, sem rolagem horizontal. A vitrine também havia sido conferida em 320 px na revisão anterior. Não houve erro de execução no console da vitrine durante a conferência final.

As interações usaram banco e assets separados em work, chave exclusiva de QA e dados fictícios. Os registros reais já existentes não foram utilizados nos testes.

## Limites que permanecem

1. **Configuração local.** O servidor continua ligado exclusivamente a 127.0.0.1. Não exponha esta versão por túnel ou diretamente na internet.
2. **Pagamento de teste preparado, não ativado.** Mercado Pago Checkout Pro implementado com conta vendedora de teste, assinatura HMAC, comparação de valor, moeda, referência, vendedor e preferência. Sem configuração completa, retorna 503. O ensaio externo ainda não foi realizado. Produção permanece bloqueada; ver MERCADO-PAGO.md.
3. **Autenticação de desenvolvimento.** O cookie não usa Secure porque o ambiente é HTTP local. Para produção: HTTPS, cookies Secure, identidade administrativa adequada, recuperação e proteção adicional da conta.
4. **Dados locais sem criptografia pela aplicação.** Chave, banco e backups dependem da proteção da conta Windows. Um processo que comprometa a conta pode lê-los. Use dados fictícios nesta fase. O backup inclui a chave: não o compartilhe.
5. **Frete ilustrativo.** A tarifa e os prazos são exemplos configuráveis, sem transportadora integrada. Reservas novas têm expiração; pedidos antigos sem prazo são preservados.
6. **Serviços e conteúdo externos.** Google Fonts ainda é acessado pelo navegador; ViaCEP é opcional. Imagens remotas cadastradas pelo proprietário continuam restritas a images.unsplash.com; as fotos demonstrativas padrão são locais. Substitua as fotos e as informações comerciais antes da abertura.
7. **Sem auditoria de infraestrutura pública.** Domínio, TLS, hospedagem, gateway, e-mail transacional, monitoramento, retenção de dados e políticas comerciais reais ainda precisam ser configurados e revisados.
8. **Sem garantia universal.** Não foi realizado teste de carga, teste de penetração externo, varredura antivírus das fotos, avaliação de todos os navegadores ou teste em aparelhos físicos. Não há pacotes npm de terceiros declarados; isso não elimina vulnerabilidades do runtime ou sistema operacional.

## Aplicar a atualização

Encerre o servidor antigo com Ctrl+C, inicie novamente e recarregue as páginas. Banco, catálogo e pedidos existentes são preservados; as novas tabelas são criadas na inicialização. Foi criado um backup privado antes da entrega, dentro de data/backups. O ZIP de código é verificado para excluir banco, backups, chaves e arquivos de ambiente.

## Referências

- [OWASP — Node.js Security](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
- [OWASP — CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP — Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html)
- [ViaCEP — contrato de consulta](https://viacep.com.br/)
- [Google — WebP Container Specification](https://developers.google.com/speed/webp/docs/riff_container)
- [Node.js — segurança de outubro de 2026](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)

## Revisão incremental · 03/11/2026 · versão 0.4.1

Adicionados navegação de contatos e convite não modal do Instagram. WhatsApp e perfil são validados antes de formar URLs fixas de wa.me e instagram.com. Links externos usam noopener/noreferrer. Não foram adicionados scripts externos, embeds, envio de mensagens nem novas permissões do navegador. A CSP e a autenticação permanecem iguais. O encerramento do convite é salvo apenas no sessionStorage. Links e largura de 390 px foram conferidos no navegador, sem rolagem horizontal.

## Revisão incremental · Mercado Pago · versão 0.5.0

Adicionados 13 cenários de pagamento: configuração incompleta e produção bloqueadas, validação do redirecionamento, concorrência da sessão, bloqueio de conta real, retenção de estoque incerto, assinatura falsa/antiga/corpo divergente, duplicata, retorno forjado, divergência de valor/moeda/ambiente/vendedor/preferência, consulta manual, evento atrasado, estorno, aprovação tardia, segundo pagamento, timeout e isolamento do painel pelo Host público. Credenciais ficam em .env.local, ignorado no Git e excluído do ZIP.

O processamento de webhook é síncrono; falhas retornam erro e dependem de reentrega do provedor ou atualização manual. Reservas com checkout iniciado permanecem retidas até conferência; nenhuma rotina local cancela ou estorna no provedor. São limitações deliberadas desta etapa de teste, não um ciclo financeiro completo de produção. Nenhum túnel, domínio ou credencial real foi configurado.
