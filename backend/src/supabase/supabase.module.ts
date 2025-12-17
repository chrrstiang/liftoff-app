import { Module } from "@nestjs/common";
import { SupabaseService } from "./supabase.service";
import { ConfigModule } from "@nestjs/config";

/*
Encapsulates supabase client instantiation. Accessible through service layer.
*/
@Module({
    imports: [ConfigModule],
    controllers: [],
    providers: [SupabaseService],
    exports: [SupabaseService]
})

export class SupabaseModule{}
