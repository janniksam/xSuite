#![no_std]

use crate::types::data_types::{
    ArrayDataTypes, MaintenanceStatus, ManagedDataTypes, OptionDataTypes, OtherDataTypes,
    PrimitiveDataTypes, SubType,
};

multiversx_sc::imports!();

mod types;

#[multiversx_sc::contract]
pub trait DataTypes {
    #[init]
    fn init(&self) {
        self.single_value_mapper(0).set(1);
        self.single_value_mapper(1).set(2);
        self.vec_mapper(0).push(&1);
        self.vec_mapper(0).push(&2);
        self.vec_mapper(1).push(&10);
        self.vec_mapper(1).push(&11);
        self.set_mapper(0).insert(1);
        self.set_mapper(0).insert(2);
        self.set_mapper(0).insert(3);
        self.set_mapper(1).insert(5);
        self.set_mapper(1).insert(6);
        self.set_mapper(1).insert(7);
        self.unordered_set_mapper(0).insert(1);
        self.unordered_set_mapper(0).insert(2);
        self.unordered_set_mapper(1).insert(5);
        self.unordered_set_mapper(1).insert(6);
        self.map_mapper(0).insert(0, 1);
        self.map_mapper(0).insert(1, 2);
        self.map_mapper(1).insert(1, 10);
        self.map_mapper(1).insert(2, 11);
    }

    #[view(getPrimitiveDataTypes)]
    fn get_primitive_datatypes(&self) -> PrimitiveDataTypes {
        let types = PrimitiveDataTypes {
            boolean: true,
            unsigned8: 10,
            unsigned16: 1000,
            unsigned32: 100000,
            unsigned64: 1000000000000000000,
            unsigned_size: 200000,
            signed8: 5,
            signed16: 500,
            signed32: 50000,
            signed64: 500000000000000000,
            signed_size: 300000,
            enumeration: MaintenanceStatus::InMaintenance,
        };
        return types;
    }

    #[view(getManagedDataTypes)]
    fn get_managed_datatypes(&self) -> ManagedDataTypes<Self::Api> {
        let types = ManagedDataTypes {
            managed_buffer: ManagedBuffer::from("abcd"),
            big_unsigned_integer: BigUint::from(20000000000u64),
            big_integer: BigInt::from(10000000000i64),
            // big_float: BigInt::from(10000000000i64),
            address: self.blockchain().get_sc_address(),
            token_identifer: TokenIdentifier::from("ABCDEF-123456"),
            egld_or_esdt_token_identifer: EgldOrEsdtTokenIdentifier::esdt("ABCDEF-123456"),
            esdt_token_payment: EsdtTokenPayment::new(
                TokenIdentifier::from("ABCDEF-123456"),
                120,
                BigUint::from(1000000u64),
            ),
            egld_or_esdt_token_payment: EgldOrEsdtTokenPayment::new(
                EgldOrEsdtTokenIdentifier::esdt("ABCDEF-123456"),
                360,
                BigUint::from(2000000u64),
            ),
        };
        return types;
    }

    #[view(getOptionDataTypes)]
    fn get_option_datatypes(&self) -> OptionDataTypes<Self::Api> {
        let types = OptionDataTypes {
            option_of_biguint_set: Option::Some(BigUint::from(420u64)),
            option_of_biguint_not_set: Option::None,
            option_of_subtype_set: Option::Some(SubType {
                big_unsigned_integer: BigUint::from(12u8),
                address: self.blockchain().get_sc_address(),
            }),
            option_of_subtype_not_set: Option::None,
        };
        return types;
    }

    #[view(getArrayDataTypes)]
    fn get_array_datatypes(&self) -> ArrayDataTypes<Self::Api> {
        let types = ArrayDataTypes {
            managed_vec_of_u16: self.get_sample_mvec(),
            managed_vec_of_subtype: self.get_sample_mvec_complex(),
            fixed_array: [1, 2, 3, 4, 5],
            fixed_array_complex: [
                SubType {
                    address: self.blockchain().get_sc_address(),
                    big_unsigned_integer: BigUint::from(100000000u64),
                },
                SubType {
                    address: self.blockchain().get_sc_address(),
                    big_unsigned_integer: BigUint::from(200000000u64),
                },
                SubType {
                    address: self.blockchain().get_sc_address(),
                    big_unsigned_integer: BigUint::from(300000000u64),
                },
            ],
            tuples: (10, 300),
            tuples_complex: (
                20,
                SubType {
                    address: self.blockchain().get_sc_address(),
                    big_unsigned_integer: BigUint::from(300000000u64),
                },
            ),
        };
        return types;
    }

    #[view(getOtherDataTypes)]
    fn get_other_datatypes(&self) -> OtherDataTypes<Self::Api> {
        let types = OtherDataTypes {
            custom_type: SubType {
                address: self.blockchain().get_sc_address(),
                big_unsigned_integer: BigUint::from(100000000u64),
            },
        };
        return types;
    }

    #[endpoint(setPrimitiveDataTypes)]
    fn set_primitive_datatypes(&self, data: PrimitiveDataTypes) -> PrimitiveDataTypes {
        data
    }

    #[endpoint(setManagedDataTypes)]
    fn set_managed_datatypes(
        &self,
        data: ManagedDataTypes<Self::Api>,
    ) -> ManagedDataTypes<Self::Api> {
        data
    }

    #[endpoint(setOptionDataTypes)]
    fn set_option_datatypes(&self, data: OptionDataTypes<Self::Api>) -> OptionDataTypes<Self::Api> {
        data
    }

    #[endpoint(setArrayrDataTypes)]
    fn set_array_datatypes(&self, data: ArrayDataTypes<Self::Api>) -> ArrayDataTypes<Self::Api> {
        data
    }

    #[endpoint(setOtherDataTypes)]
    fn set_other_datatypes(&self, data: OtherDataTypes<Self::Api>) -> OtherDataTypes<Self::Api> {
        data
    }

    #[view(getOptionalValue1stArg)]
    fn get_optional_value_1st_arg(
        &self,
        optional_value_arg: OptionalValue<u8>,
    ) -> OptionalValue<u8> {
        optional_value_arg
    }

    #[view(getOptionalValue2ndArg)]
    fn get_optional_value_2nd_arg(
        &self,
        required_arg: u8,
        optional_value_arg: OptionalValue<u8>,
    ) -> MultiValue2<u8, OptionalValue<u8>> {
        let result = MultiValue2::from((required_arg, optional_value_arg));
        result
    }

    #[view(getSingleValueMapper)]
    #[storage_mapper("single_value_mapper")]
    fn single_value_mapper(&self, input: u8) -> SingleValueMapper<u64>;

    #[view(getVecMapper)]
    #[storage_mapper("vec_mapper")]
    fn vec_mapper(&self, input: u8) -> VecMapper<u64>;

    #[view(getSetMapper)]
    #[storage_mapper("set_mapper")]
    fn set_mapper(&self, input: u8) -> SetMapper<u64>;

    #[view(getUnorderedSetMapper)]
    #[storage_mapper("unordered_set_mapper")]
    fn unordered_set_mapper(&self, input: u8) -> UnorderedSetMapper<u64>;

    #[view(getMapMapper)]
    #[storage_mapper("map_mapper")]
    fn map_mapper(&self, input: u8) -> MapMapper<u8, u16>;

    fn get_sample_mvec(&self) -> ManagedVec<u16> {
        let mut vec = ManagedVec::new();
        vec.push(12u16);
        vec.push(26u16);
        vec.push(3u16);
        return vec;
    }

    fn get_sample_mvec_complex(&self) -> ManagedVec<SubType<Self::Api>> {
        let mut vec = ManagedVec::new();
        vec.push(SubType {
            address: self.blockchain().get_sc_address(),
            big_unsigned_integer: BigUint::from(14u8),
        });
        vec.push(SubType {
            address: self.blockchain().get_owner_address(),
            big_unsigned_integer: BigUint::from(133u8),
        });
        return vec;
    }
}
