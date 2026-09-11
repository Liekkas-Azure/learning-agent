import { VaultEntryDetail } from "@/components/vault/VaultEntryDetail";

type Props = { params: Promise<{ entryId: string }> };

export default async function VaultEntryRoutePage(props: Props) {
  const { entryId } = await props.params;
  return <VaultEntryDetail entryId={entryId} />;
}
