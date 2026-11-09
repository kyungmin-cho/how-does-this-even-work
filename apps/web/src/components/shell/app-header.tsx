"use client";

import { ListTreeIcon, MoreHorizontalIcon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resetEverything } from "@/lib/engine-bridge";
import { listProducts } from "@/lib/products";
import { APP_NAME } from "@/lib/site";
import { useAppStore } from "@/store";

export function AppHeader({ phone = false }: { phone?: boolean }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3">
      {phone && <PartsDrawerButton />}
      <ProductSelect />
      <h1 className="min-w-0 truncate text-sm font-semibold">{APP_NAME}</h1>
      <div className="ml-auto flex items-center gap-1">
        <ArButton />
        <AppMenu />
      </div>
    </header>
  );
}

function PartsDrawerButton() {
  const setUi = useAppStore((s) => s.setUi);
  return (
    <Button variant="ghost" size="icon" aria-label="부품 목록" onClick={() => setUi({ partsDrawerOpen: true })}>
      <ListTreeIcon />
    </Button>
  );
}

function ProductSelect() {
  const router = useRouter();
  const slug = useAppStore((s) => s.productSlug);
  const products = listProducts();
  return (
    <Select value={slug ?? ""} onValueChange={(next) => router.push(`/studio/${next}`)}>
      <SelectTrigger aria-label="제품" size="sm" className="max-w-40 shrink-0">
        <SelectValue placeholder="제품 고르기" />
      </SelectTrigger>
      <SelectContent>
        {products.map((p) => (
          <SelectItem key={p.slug} value={p.slug}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** AR lives in @assembly/ar; the button stays visible but off until that lands. */
function ArButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md" aria-describedby="ar-soon">
          <Button variant="outline" size="sm" disabled>
            AR로 보기
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent id="ar-soon">AR은 준비 중이에요</TooltipContent>
    </Tooltip>
  );
}

function AppMenu() {
  const open = useAppStore((s) => s.ui.resetDialogOpen);
  const setUi = useAppStore((s) => s.setUi);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="메뉴">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setUi({ resetDialogOpen: true })}>
            <RotateCcwIcon /> 처음부터 다시 시작
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={open} onOpenChange={(next) => setUi({ resetDialogOpen: next })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>처음부터 다시 시작할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              이 기기에 저장된 대화, 진행 단계, 화면 배치가 모두 지워져요. 되돌릴 수 없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={resetEverything}>지우고 다시 시작</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
