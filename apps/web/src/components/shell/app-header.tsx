"use client";

import { ListTreeIcon, MoreHorizontalIcon, RotateCcwIcon, ScanEyeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

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
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { resetEverything } from "@/lib/engine-bridge";
import { listProducts } from "@/lib/products";
import { APP_NAME } from "@/lib/site";
import { useAppStore } from "@/store";

/**
 * One line, Notion-style: "app / product" as plain-text breadcrumbs, the menu on the right.
 * `leading` holds a layout control at the far left (open the parts panel or drawer).
 */
export function AppHeader({ phone = false, leading }: { phone?: boolean; leading?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-background px-3">
      {phone ? <PartsDrawerButton /> : leading}
      <Breadcrumb aria-label="현재 위치" className="min-w-0">
        <BreadcrumbList className="flex-nowrap gap-1.5">
          <BreadcrumbItem className="min-w-0">
            <h1
              className={cn(
                "min-w-0 truncate",
                phone ? "text-xs text-muted-foreground" : "text-sm font-medium text-foreground",
              )}
            >
              {APP_NAME}
            </h1>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="text-muted-foreground/60">/</BreadcrumbSeparator>
          <BreadcrumbItem className="shrink-0">
            <ProductSelect />
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center">
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
      <SelectTrigger
        aria-label="제품"
        size="sm"
        className="max-w-44 border-transparent px-1.5 text-foreground shadow-none hover:bg-accent data-[state=open]:bg-accent"
      >
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
        <DropdownMenuContent align="end" className="min-w-52">
          {/* AR lives in @assembly/ar; it stays listed but off until that lands. */}
          <DropdownMenuItem disabled>
            <ScanEyeIcon /> AR로 보기
            <Badge variant="secondary" className="ml-auto">
              준비 중
            </Badge>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
